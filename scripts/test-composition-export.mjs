// Real MP4/PNG integration check using generated media only. Requires the built app.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { projectCommand, probeMedia } from '../cli/core/compositionProject.mjs';
import { renderProject } from '../cli/core/headlessRenderer.mjs';
import { getFfmpegPath } from '../cli/core/paths.mjs';
const run=promisify(execFile), dir=await fs.mkdtemp(path.join(os.tmpdir(),'recordly-composition-check-'));
const file=name=>path.join(dir,name);
const ffmpeg=async args=>run(getFfmpegPath(),['-v','error','-y',...args],{maxBuffer:8*1024*1024});
try {
 await ffmpeg(['-f','lavfi','-i','testsrc2=size=640x360:rate=30','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','8','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',file('main.mp4')]);
 await ffmpeg(['-f','lavfi','-i','color=blue:size=320x320:rate=30','-t','8','-c:v','libx264',file('face.mp4')]);
 await ffmpeg(['-f','lavfi','-i','color=red:size=640x360:rate=30','-f','lavfi','-i','sine=frequency=660:sample_rate=48000','-t','3','-c:v','libx264','-c:a','aac',file('broll.mp4')]);
 await ffmpeg(['-f','lavfi','-i','color=green:size=320x180','-frames:v','1',file('image.png')]);
 await fs.writeFile(file('input.recordly'),JSON.stringify({version:2,videoPath:file('main.mp4'),editor:{webcam:{sourcePath:file('face.mp4'),enabled:true},clipRegions:[{id:'main',startMs:0,endMs:8000,speed:1}]}}));
 const shots=['screen','presenter','pip','split'].map((mode,i)=>({id:`talk-${i}`,kind:'main',sourceStartMs:i*2000,sourceEndMs:(i+1)*2000,speed:1,layout:{mode}}));
 shots.splice(2,0,{id:'card',kind:'card',template:'quote',title:'Standalone card',durationMs:1000});
 const roll=(id,clipId,assetId,mode,muted)=>({id,clipId,assetId,offsetMs:500,durationMs:1000,sourceStartMs:0,speed:1,muted,volume:.5,mode,x:.05,y:.05,width:.3,height:.3});
 const plan={version:1,composition:{width:640,height:360,fps:30,assets:[{id:'video',path:file('broll.mp4'),kind:'video'},{id:'image',path:file('image.png'),kind:'image'}],shots,broll:[roll('muted','talk-0','video','pip',true),roll('cutaway','talk-2','video','fullscreen',false),roll('screenshot','talk-3','image','pip',true)]}};
 await projectCommand('apply',file('input.recordly'),{planData:plan,output:file('composed.recordly')});
 const report=await renderProject({projectPath:file('composed.recordly'),outputPath:file('output.mp4'),fps:30,timeoutMs:180000});
 assert.equal(report.report.success,true);
 const meta=await probeMedia(file('output.mp4'));
 assert.ok(meta.hasAudio&&meta.hasVideo);assert.ok(Math.abs(meta.durationMs-9000)<80);
 const pixel=async(t,x,y)=>{
  const {stdout}=await run(getFfmpegPath(),['-v','error','-ss',String(t),'-i',file('output.mp4'),'-vf',`format=rgb24,crop=1:1:${x}:${y}`,'-frames:v','1','-f','rawvideo','-'],{encoding:'buffer'});
  return [...stdout.subarray(0,3)];
 };
 const isBlue=([r,g,b])=>b>180&&r<40&&g<40;
 assert.ok(isBlue(await pixel(3,320,180)),'Presenter layout must fill the frame');
 assert.ok(isBlue(await pixel(5.1,600,330)),'PiP must show the webcam in its corner');
 assert.ok(isBlue(await pixel(8,100,300)),'Split layout must show the webcam on the left');
 const red=await pixel(5.8,320,180);assert.ok(red[0]>180&&red[1]<40&&red[2]<40,'Fullscreen B-roll must cover the main image');
 const green=await pixel(8,65,55);assert.ok(green[1]>90&&green[0]<40&&green[2]<40,'Image PiP must appear in its configured rectangle');

 await ffmpeg(['-i',file('output.mp4'),'-vn','-ac','1','-ar','48000','-f','f32le',file('audio.raw')]);
 const pcm=await fs.readFile(file('audio.raw'));
 const samples=(start,end)=>Array.from({length:Math.floor((end-start)*48000)},(_,i)=>pcm.readFloatLE((Math.floor(start*48000)+i)*4));
 const rms=x=>Math.sqrt(x.reduce((n,s)=>n+s*s,0)/x.length);
 const tone=(x,hz)=>2*Math.hypot(x.reduce((n,s,i)=>n+s*Math.cos(2*Math.PI*hz*i/48000),0),x.reduce((n,s,i)=>n+s*Math.sin(2*Math.PI*hz*i/48000),0))/x.length;
 assert.ok(rms(samples(4.2,4.8))<.00001,'Main sound must stop during the card');
 assert.ok(tone(samples(.7,1.3),440)>.05,'Main sound must continue under muted B-roll');
 assert.ok(tone(samples(.7,1.3),660)<.001,'Muted B-roll must contribute no audio');
 assert.ok(tone(samples(5.7,6.3),660)>.01,'Enabled B-roll audio must be mixed');
 await projectCommand('preview',file('composed.recordly'),{at:5800,output:file('preview.png')});
 await ffmpeg(['-ss','5.8','-i',file('output.mp4'),'-frames:v','1',file('export.png')]);
 const similarity=await run(getFfmpegPath(),['-i',file('preview.png'),'-i',file('export.png'),'-lavfi','psnr','-f','null','-']);
 const average=similarity.stderr.match(/average:([\d.]+|inf)/)?.[1];
 assert.ok(average==='inf'||Number(average)>35,`Preview/export image mismatch: ${average}`);
 console.log(JSON.stringify({success:true,durationMs:meta.durationMs,checks:['four layouts','video and image B-roll','card silence','continuous main audio','muted and enabled B-roll audio','CLI screenshot matches exported frame']},null,2));
} finally { await fs.rm(dir,{recursive:true,force:true}); }
