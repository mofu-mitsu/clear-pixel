(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const ids = ['sharpness','denoise','compression','smooth'];
  const originalCanvas = $('originalCanvas'), resultCanvas = $('resultCanvas');
  const originalCtx = originalCanvas.getContext('2d', {willReadFrequently:true});
  const resultCtx = resultCanvas.getContext('2d');
  const MAX_SIDE = 1600;
  let originalData = null, sourceFile = null, compareOff = false, renderTimer = 0, renderId = 0, busyTimer = 0;

  const bytes = n => n < 1048576 ? Math.round(n/1024)+' KB' : (n/1048576).toFixed(2)+' MB';
  const status = text => $('status').textContent = text;
  const updateLabels = () => ids.forEach(id => $(id+'Value').textContent = $(id).value+'%');

  function openFile(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) { status('画像ファイルを選んでね'); return; }
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      sourceFile = file;
      const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      originalCanvas.width = resultCanvas.width = w;
      originalCanvas.height = resultCanvas.height = h;
      originalCtx.drawImage(img, 0, 0, w, h);
      originalData = originalCtx.getImageData(0, 0, w, h);
      $('dropzone').hidden = true;
      $('previewGrid').hidden = false;
      $('emptyNote').hidden = true;
      $('fileInfo').hidden = false;
      $('previewActions').hidden = false;
      $('dimensions').textContent = img.naturalWidth+' × '+img.naturalHeight+' px'+(scale<1?'（最大辺1600pxに縮小）':'');
      $('fileSize').textContent = file.name+' · '+bytes(file.size);
      $('downloadButton').disabled = $('resetButton').disabled = false;
      compareOff = false; $('compareButton').textContent = '補正を一時オフ';
      status('画像を読み込みました');
      URL.revokeObjectURL(url);
      render();
    };
    img.onerror = () => { status('この画像は読み込めませんでした'); URL.revokeObjectURL(url); };
    img.src = url;
  }

  function processPixels(src, w, h) {
    const sharp = +$('sharpness').value / 100;
    const denoise = +$('denoise').value / 100;
    const comp = +$('compression').value / 100;
    const smooth = +$('smooth').value / 100;
    const input = src.data;
    let base = new Uint8ClampedArray(input);
    const out = new Uint8ClampedArray(input.length);
    const at = (x,y,c) => (y*w+x)*4+c;

    // Cheap separable blur; avoids sorting nine values for every pixel.
    if (denoise || comp || smooth) {
      const horizontal = new Uint8ClampedArray(input.length);
      const vertical = new Uint8ClampedArray(input.length);
      for (let y=0; y<h; y++) for (let x=0; x<w; x++) {
        const i=(y*w+x)*4;
        for(let c=0;c<3;c++){
          horizontal[i+c]=(input[at(Math.max(0,x-1),y,c)]+2*input[i+c]+input[at(Math.min(w-1,x+1),y,c)])/4;
        }
        horizontal[i+3]=input[i+3];
      }
      for (let y=0; y<h; y++) for (let x=0; x<w; x++) {
        const i=(y*w+x)*4;
        for(let c=0;c<3;c++){
          const blur=(horizontal[at(x,Math.max(0,y-1),c)]+2*horizontal[i+c]+horizontal[at(x,Math.min(h-1,y+1),c)])/4;
          const original=input[i+c];
          const amount=Math.min(.78, denoise*.5+comp*.3+smooth*.48);
          vertical[i+c]=original*(1-amount)+blur*amount;
        }
        vertical[i+3]=input[i+3];
      }
      base=vertical;
    } else base.set(input);

    if (sharp > 0) {
      const amount = sharp * 1.35;
      for(let y=0;y<h;y++) for(let x=0;x<w;x++){
        const i=(y*w+x)*4;
        for(let c=0;c<3;c++){
          const blur=(base[at(Math.max(0,x-1),y,c)]+base[at(Math.min(w-1,x+1),y,c)]+base[at(x,Math.max(0,y-1),c)]+base[at(x,Math.min(h-1,y+1),c)])/4;
          out[i+c]=Math.max(0,Math.min(255,base[i+c]+(base[i+c]-blur)*amount));
        }
        out[i+3]=input[i+3];
      }
    } else out.set(base);
    return new ImageData(out,w,h);
  }

  function render() {
    updateLabels();
    if (!originalData) return;
    clearTimeout(renderTimer);
    clearTimeout(busyTimer);
    renderTimer = setTimeout(() => {
      const thisRender = ++renderId;
      $('busy').hidden = false;
      // Wait until the next frame before CPU work, so rapid slider movement is coalesced.
      requestAnimationFrame(() => {
        if (thisRender !== renderId) return;
        const result = processPixels(originalData, originalCanvas.width, originalCanvas.height);
        if (thisRender !== renderId) return;
        resultCtx.putImageData(result,0,0);
        $('resultCanvas').style.visibility = compareOff ? 'hidden' : 'visible';
        $('busy').hidden = true;
        status(compareOff ? '補正を一時オフ' : 'プレビューを更新しました');
      });
    }, 90);
  }

  ids.forEach(id => $(id).addEventListener('input', () => { compareOff=false; $('compareButton').textContent='補正を一時オフ'; render(); }));
  $('fileInput').addEventListener('change', e => openFile(e.target.files[0]));
  const dz=$('dropzone');
  ['dragenter','dragover'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.add('drag')}));
  ['dragleave','drop'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.remove('drag')}));
  dz.addEventListener('drop',e=>openFile(e.dataTransfer.files[0]));
  $('changeImage').addEventListener('click',()=>$('fileInput').click());
  $('compareButton').addEventListener('click',()=>{
    compareOff=!compareOff;
    $('compareButton').textContent=compareOff?'補正を再表示':'補正を一時オフ';
    if(compareOff){clearTimeout(renderTimer);$('resultCanvas').style.visibility='hidden';$('busy').hidden=true;status('補正を一時オフ')}
    else render();
  });
  $('resetButton').addEventListener('click',()=>{ $('sharpness').value=35;$('denoise').value=10;$('compression').value=8;$('smooth').value=0;render(); });
  $('downloadButton').addEventListener('click',()=>{
    if(!originalData)return;
    const data=processPixels(originalData,originalCanvas.width,originalCanvas.height);
    const c=document.createElement('canvas');c.width=originalCanvas.width;c.height=originalCanvas.height;
    c.getContext('2d').putImageData(data,0,0);
    const type=$('format').value;
    c.toBlob(blob=>{
      if(!blob){status('保存に失敗しました');return}
      const url=URL.createObjectURL(blob),a=document.createElement('a');
      a.href=url;a.download=(sourceFile.name.replace(/\.[^.]+$/,'')||'image')+'-clear-pixel.'+(type==='image/jpeg'?'jpg':'png');
      document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
      status('補正した画像を保存しました');
    },type,type==='image/jpeg'?.94:undefined);
  });
  const dialog=$('helpDialog');
  $('helpOpen').addEventListener('click',()=>dialog.showModal());
  $('helpClose').addEventListener('click',()=>dialog.close());
  $('helpDone').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close()});
})();