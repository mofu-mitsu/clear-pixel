(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const ids = ['sharpness','denoise','compression','smooth'];
  const originalCanvas = $('originalCanvas'), resultCanvas = $('resultCanvas');
  const originalCtx = originalCanvas.getContext('2d', {willReadFrequently:true});
  const resultCtx = resultCanvas.getContext('2d');
  const MAX_SIDE = 1600;
  let originalData = null, sourceFile = null, compareOff = false, renderTimer = 0, renderId = 0, busyTimer = 0, aiMode = false, ortSession = null, ortModelUrl = null;

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
      $('compareSliderWrap').hidden = false;
      $('emptyNote').hidden = true;
      $('fileInfo').hidden = false;
      $('previewActions').hidden = false;
      $('dimensions').textContent = img.naturalWidth+' × '+img.naturalHeight+' px'+(scale<1?'（最大辺1600pxに縮小）':'');
      $('fileSize').textContent = file.name+' · '+bytes(file.size);
      $('downloadButton').disabled = $('resetButton').disabled = false;
      compareOff = false; $('compareButton').textContent = '補正を一時オフ'; $('originalCanvas').style.opacity='1'; $('originalCanvas').style.clipPath='none'; $('resultCanvas').style.opacity='1'; $('compareSlider').value=50; $('compareValue').textContent='50% 補正前';
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
    const out = new Uint8ClampedArray(input.length);
    const at = (x,y,c) => (y*w+x)*4+c;

    // Sharpness uses a 5x5 separable box blur to extract broader edge detail.
    // Keep this stage independent from denoise/smooth so sharpness=100 is visible even when those are zero.
    const radius = 2;
    const horizontal = new Float32Array(input.length);
    const blurred = new Float32Array(input.length);
    for(let y=0;y<h;y++) for(let x=0;x<w;x++){
      const i=(y*w+x)*4;
      for(let c=0;c<3;c++){
        let sum=0;
        for(let dx=-radius;dx<=radius;dx++) sum+=input[at(Math.max(0,Math.min(w-1,x+dx)),y,c)];
        horizontal[i+c]=sum/(radius*2+1);
      }
      horizontal[i+3]=input[i+3];
    }
    for(let y=0;y<h;y++) for(let x=0;x<w;x++){
      const i=(y*w+x)*4;
      for(let c=0;c<3;c++){
        let sum=0;
        for(let dy=-radius;dy<=radius;dy++) sum+=horizontal[at(x,Math.max(0,Math.min(h-1,y+dy)),c)];
        blurred[i+c]=sum/(radius*2+1);
      }
      blurred[i+3]=input[i+3];
    }
    const cleanup=Math.min(.72,denoise*.42+comp*.38+smooth*.28);
    const strength=sharp*9.0;
    for(let y=0;y<h;y++) for(let x=0;x<w;x++){
      const i=(y*w+x)*4;
      for(let c=0;c<3;c++){
        const original=input[i+c];
        const cleaned=original*(1-cleanup)+blurred[i+c]*cleanup;
        const detail=original-blurred[i+c];
        // At zero sharpness preserve the input exactly (unless cleanup sliders are active).
        // Stronger gain makes the deliberately blurred demo visibly respond at high values.
        const sharpened = cleaned + detail * strength;
        out[i+c]=Math.max(0,Math.min(255,sharpened));
      }
      out[i+3]=input[i+3];
    }
    return new ImageData(out,w,h);
  }

  function render() {
    updateLabels();
    if (!originalData) return;
    // AI output may be 4x larger; preview canvases must retain the source preview dimensions.
    if (resultCanvas.width !== originalCanvas.width || resultCanvas.height !== originalCanvas.height) {
      resultCanvas.width = originalCanvas.width; resultCanvas.height = originalCanvas.height;
    }
    clearTimeout(renderTimer);
    clearTimeout(busyTimer);
    renderTimer = setTimeout(() => {
      const thisRender = ++renderId;
      $('busy').hidden = false;
      $('busy').setAttribute('aria-live','polite');
      // Wait until the next frame before CPU work, so rapid slider movement is coalesced.
      requestAnimationFrame(() => {
        if (thisRender !== renderId) return;
        const result = processPixels(originalData, originalCanvas.width, originalCanvas.height);
        if (thisRender !== renderId) return;
        resultCtx.putImageData(compareOff ? originalData : result,0,0);
        $('resultCanvas').style.visibility = 'visible';
        $('resultCanvas').style.opacity = '1';
        $('busy').hidden = true;
        status(compareOff ? '補正を一時オフ' : 'プレビューを更新しました');
      });
    }, 90);
  }

  ids.forEach(id => $(id).addEventListener('input', () => { compareOff=false; $('compareButton').textContent='補正を一時オフ'; updateLabels(); clearTimeout(renderTimer); renderTimer=setTimeout(render, 45); }));
  $('fileInput').addEventListener('change', e => openFile(e.target.files[0]));
  const dz=$('dropzone');
  ['dragenter','dragover'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.add('drag')}));
  ['dragleave','drop'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.remove('drag')}));
  dz.addEventListener('drop',e=>openFile(e.dataTransfer.files[0]));
  $('changeImage').addEventListener('click',()=>$('fileInput').click());
  $('compareButton').addEventListener('click',()=>{
    compareOff=!compareOff;
    $('compareButton').textContent=compareOff?'補正を再表示':'補正を一時オフ';
    if(compareOff){clearTimeout(renderTimer);renderId++;if(originalData)resultCtx.putImageData(originalData,0,0);$('resultCanvas').style.visibility='visible';$('resultCanvas').style.opacity='1';$('originalCanvas').style.opacity='1';$('originalCanvas').style.clipPath='none';$('busy').hidden=true;status('補正を一時オフ（補正後欄にも元画像を表示）')}
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

  // Synthetic samples make the effect easy to inspect without uploading a photo.
  function sampleImage(kind) {
    const w=720,h=440, c=document.createElement('canvas'); c.width=w;c.height=h;
    const ctx=c.getContext('2d');
    ctx.fillStyle='#f8eaf1';ctx.fillRect(0,0,w,h);
    if(kind==='noise'){
      ctx.fillStyle='#d8a8c0';ctx.fillRect(55,55,610,330);
      for(let y=55;y<385;y+=2)for(let x=55;x<665;x+=2){
        const v=Math.random()*255;ctx.fillStyle='rgb('+Math.round(v)+','+Math.round(v*.75)+','+Math.round(v)+')';ctx.fillRect(x,y,2,2);
      }
      ctx.fillStyle='#56364a';ctx.font='bold 38px sans-serif';ctx.fillText('NOISE TEST',180,235);
    } else if(kind==='blur') {
      ctx.fillStyle='#d85c98';ctx.beginPath();ctx.arc(230,210,95,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#fff';ctx.fillRect(355,125,220,170);ctx.fillStyle='#7c3159';ctx.font='bold 44px sans-serif';ctx.fillText('BLUR',390,220);
      const temp=document.createElement('canvas');temp.width=w;temp.height=h;temp.getContext('2d').drawImage(c,0,0);
      ctx.clearRect(0,0,w,h);ctx.filter='blur(10px)';ctx.drawImage(temp,0,0);ctx.filter='none';
    } else {
      ctx.fillStyle='#fff';ctx.fillRect(65,55,590,330);ctx.strokeStyle='#bd4e83';ctx.lineWidth=5;ctx.strokeRect(85,75,550,290);
      ctx.fillStyle='#553344';ctx.font='bold 48px sans-serif';ctx.fillText('Clear Pixel',115,170);
      ctx.font='28px sans-serif';ctx.fillText('EDGE / TEXT SAMPLE',115,225);
      ctx.beginPath();ctx.moveTo(115,275);ctx.lineTo(600,275);ctx.stroke();
      // Deliberately blur the entire rendered sample so the sharpness control has a visible target.
      const temp=document.createElement('canvas');temp.width=w;temp.height=h;temp.getContext('2d').drawImage(c,0,0);
      ctx.clearRect(0,0,w,h);ctx.filter='blur(4px)';ctx.drawImage(temp,0,0);ctx.filter='none';
    }
    c.toBlob(blob=>{if(blob)openFile(new File([blob],'clear-pixel-'+kind+'.png',{type:'image/png'}))},'image/png');
  }
  document.querySelectorAll('[data-sample]').forEach(b=>b.addEventListener('click',()=>sampleImage(b.dataset.sample)));

  $('normalMode').addEventListener('click',()=>{aiMode=false;$('normalMode').classList.add('active');$('aiMode').classList.remove('active');$('aiPanel').hidden=true;status('通常補正モード');render();});
  $('aiMode').addEventListener('click',()=>{aiMode=true;$('aiMode').classList.add('active');$('normalMode').classList.remove('active');$('aiPanel').hidden=false;status('AI補正ラボ');$('aiPanel').scrollIntoView({behavior:'smooth',block:'nearest'});});
  $('modelPreset').addEventListener('change',async e=>{
    const choice=e.target.value;
    $('modelFileLabel').hidden=choice!=='local';
    $('runAiButton').disabled=true;
    if(choice==='local'){$('onnxModelFile').click();return;}
    if(choice!=='realesrgan')return;
    $('aiStatus').textContent='Real-ESRGANモデルを取得中… 初回はダウンロードが必要です。';
    try {
      if(!window.ort) throw new Error('ONNX Runtime Webの読み込みに失敗しました。ページを再読み込みしてください。');
      if(ortSession){try{await ortSession.release();}catch(_){} ortSession=null;}
      const modelUrl='https://huggingface.co/skillsafe-ai/realesrgan-x4plus/resolve/main/model.onnx';
      ortSession=await ort.InferenceSession.create(modelUrl,{executionProviders:['webgpu','wasm']});
      $('aiStatus').textContent='Real-ESRGAN x4を読み込みました。画像を選択して「AI補正を実行」を押してください。';
      $('runAiButton').disabled=!originalData;
    } catch(err) {
      ortSession=null;
      $('aiStatus').textContent='モデル読み込み失敗: '+err.message+'。端末やブラウザの対応状況を確認してください。';
    }
  });
  $('onnxModelFile').addEventListener('change',async e=>{
    const file=e.target.files[0]; if(!file)return;
    $('aiStatus').textContent='ONNX Runtimeを初期化中…';$('runAiButton').disabled=true;
    try{
      if(!window.ort) throw new Error('ONNX Runtime Webの読み込みに失敗しました。ネット接続を確認してください。');
      if(ortSession){try{await ortSession.release()}catch(_){} ortSession=null;}
      if(ortModelUrl)URL.revokeObjectURL(ortModelUrl);
      ortModelUrl=URL.createObjectURL(file);
      ortSession=await ort.InferenceSession.create(ortModelUrl,{executionProviders:['wasm']});
      const ins=ortSession.inputNames.join(', '), outs=ortSession.outputNames.join(', ');
      $('aiStatus').textContent='モデル読込成功 · 入力: '+ins+' / 出力: '+outs+'。対応形式を確認して実行できます。';
      $('runAiButton').disabled=!originalData;
    }catch(err){ortSession=null;$('aiStatus').textContent='モデル読込エラー: '+err.message;}
  });
  $('runAiButton').addEventListener('click',async()=>{
    if(!ortSession||!originalData)return;
    $('runAiButton').disabled=true;
    $('aiStatus').textContent='AI補正中…画像サイズによって時間がかかります。';
    try {
      const sw=originalCanvas.width, sh=originalCanvas.height;
      const scale=Math.min(1,256/Math.max(sw,sh));
      const w=Math.max(1,Math.round(sw*scale)), h=Math.max(1,Math.round(sh*scale));
      const temp=document.createElement('canvas'); temp.width=w; temp.height=h;
      const tc=temp.getContext('2d',{willReadFrequently:true}); tc.drawImage(originalCanvas,0,0,w,h);
      const rgba=tc.getImageData(0,0,w,h).data, plane=w*h, data=new Float32Array(3*plane);
      for(let i=0;i<plane;i++){data[i]=rgba[i*4]/255;data[plane+i]=rgba[i*4+1]/255;data[2*plane+i]=rgba[i*4+2]/255;}
      const result=await ortSession.run({[ortSession.inputNames[0]]:new ort.Tensor('float32',data,[1,3,h,w])});
      const out=result[ortSession.outputNames[0]];
      if(!out||out.type!=='float32'||out.dims.length!==4||out.dims[0]!==1||out.dims[1]!==3)throw new Error('このモデルの出力形式には未対応です。');
      const oh=out.dims[2], ow=out.dims[3], od=out.data, pixels=new Uint8ClampedArray(ow*oh*4);
      for(let i=0;i<ow*oh;i++){pixels[4*i]=Math.round(Math.max(0,Math.min(1,od[i]))*255);pixels[4*i+1]=Math.round(Math.max(0,Math.min(1,od[ow*oh+i]))*255);pixels[4*i+2]=Math.round(Math.max(0,Math.min(1,od[2*ow*oh+i]))*255);pixels[4*i+3]=255;}
      const aiCanvas=document.createElement('canvas'); aiCanvas.width=ow; aiCanvas.height=oh; aiCanvas.getContext('2d').putImageData(new ImageData(pixels,ow,oh),0,0); resultCanvas.width=originalCanvas.width; resultCanvas.height=originalCanvas.height; resultCtx.clearRect(0,0,resultCanvas.width,resultCanvas.height); resultCtx.drawImage(aiCanvas,0,0,resultCanvas.width,resultCanvas.height);
      $('aiStatus').textContent='AI補正完了：'+ow+' × '+oh+' px。処理負荷を抑えるため入力を縮小しました。';
      status('AI補正を適用しました');
    } catch(err) { $('aiStatus').textContent='推論エラー: '+err.message; }
    finally { $('runAiButton').disabled=false; }
  });


  $('compareSlider').addEventListener('input',e=>{
    const pct=Number(e.target.value);
    $('compareValue').textContent=pct+'% 補正前';
    // The slider changes the visible width of the original canvas, not transparency.
    $('originalCanvas').style.clipPath='inset(0 '+(100-pct)+'% 0 0)';
    $('originalCanvas').style.opacity='1';
    $('resultCanvas').style.opacity='1';
  });

  const dialog=$('helpDialog');
  $('helpOpen').addEventListener('click',()=>dialog.showModal());
  $('helpClose').addEventListener('click',()=>dialog.close());
  $('helpDone').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close()});
})();