
let mySound;
var cBackground = 220;
var isPlaying = 1
var canvWidth;
var canvHeight;
var durationInSeconds;
var pX;
var pY;
var granularity = 4000
var mX;
var my;
// Zoom state
var zoomLevel = 1; // current (animated)
var zoomTarget = 1; // desired
var zoomCenter = 0; // time in seconds at center
const minZoom = 1;
const maxZoom = 16;
// Visible time range (updated in draw loop)
var visibleStartTime = 0;
var visibleEndTime = 0;

function formatTime(sec){
  if (!isFinite(sec) || isNaN(sec)) return '0:00';
  sec = Math.max(0, Math.floor(sec));
  const m = Math.floor(sec/60);
  const s = sec % 60;
  return m + ':' + (s<10? '0'+s : s);
}

function wavelength(){
  // deprecated: waveform is rendered in draw() to support zooming
}

function play(){
  // toggle playback
  isPlaying = isPlaying * -1;
  console.log('click');
  if (isPlaying == -1){
    if (mySound && typeof mySound.play === 'function') mySound.play();
    cBackground = 0;
    $("#play").text("Pause");
  } else {
    if (mySound && typeof mySound.pause === 'function') mySound.pause();
    cBackground = 220;
    $("#play").text("Play");
  }
  // sync container background
  const container = document.getElementById('my-p5-container');
  if (container) container.style.background = (cBackground === 0) ? 'black' : 'rgb(220,220,220)';
  // request a redraw (p5 draw loop will render)
  background(cBackground);
}

function preload() {
  // Load the sound file into the variable
  mySound = loadSound('sample.mp3'); 
}

function setup() {
  // ensure container size is known before creating canvas
  canvWidth = canvWidth || $("#my-p5-container").width() || 600;
  canvHeight = canvHeight || $("#my-p5-container").height() || 600;
  // Create the canvas
  let myCanvas = createCanvas(canvWidth, canvHeight); 
    // Attach the canvas to the div with the ID "my-p5-container"
  myCanvas.parent('my-p5-container'); 
  amplitude = new p5.Amplitude();
  durationInSeconds = mySound.duration()
  console.log(durationInSeconds);
  strokeWeight(1);
  stroke(255);
  // Example: Play the sound when the sketch starts
  // mySound.play(); 
  background(cBackground)
  wavelength()
  // use the page font for canvas text to match scrubber timestamp
  textFont('pitch');
}

function draw() {
  // animate zoom smoothly
  zoomLevel += (zoomTarget - zoomLevel) * 0.12;

  let currentTimeInSeconds = (mySound && typeof mySound.currentTime === 'function') ? mySound.currentTime() : 0;
  if (!durationInSeconds || isNaN(durationInSeconds) || durationInSeconds<=0){
    durationInSeconds = mySound.duration();
  }

  if (!zoomCenter || zoomCenter === 0) zoomCenter = currentTimeInSeconds || 0;

  const visibleDuration = Math.max(0.001, durationInSeconds / Math.max(1, zoomLevel));
  let startTime = zoomCenter - visibleDuration/2;
  if (startTime < 0) startTime = 0;
  if (startTime + visibleDuration > durationInSeconds) startTime = Math.max(0, durationInSeconds - visibleDuration);
  const endTime = startTime + visibleDuration;
  
  // Update global visible time range for scrubber to use
  visibleStartTime = startTime;
  visibleEndTime = endTime;

  // clear and render background
  background(cBackground);

  // draw waveform for visible range: dots for all samples, bars for past samples
  strokeWeight(Math.min(6, 1 + (zoomLevel-1)*0.4));
  const waveform = mySound.getPeaks(granularity);
  const startIdx = Math.floor((startTime / durationInSeconds) * granularity);
  const endIdx = Math.min(granularity-1, Math.ceil((endTime / durationInSeconds) * granularity));
  const viewSamples = Math.max(1, endIdx - startIdx + 1);

  // choose step to iterate samples mapped to canvas width
  const step = Math.max(1, Math.floor(viewSamples / Math.max(1, canvWidth)));
  noStroke();
  fill(255, 160); // dots
  // scale dot size with zoom level
  const dotSize = 2 * Math.min(2, Math.sqrt(zoomLevel));
  for (let i = 0; i < viewSamples; i += step){
    const idx = startIdx + i;
    const sample = waveform[Math.min(waveform.length-1, Math.max(0, idx))] || 0;
    const x = map(i, 0, viewSamples, 0, canvWidth);
    // half-height of bar
    const halfH = map(Math.abs(sample), 0, .25, 0, canvHeight/2);
    // dot positions: top of center-bar and top of bottom-bar
    const yTopCenter = (canvHeight/2) - halfH;
    const yTopBottom = canvHeight - halfH;
    // draw dots for all samples (visible as peaks)
    ellipse(x, yTopCenter, dotSize, dotSize);
    ellipse(x, yTopBottom, dotSize, dotSize);
  }

  // draw bars for past samples (so it looks like drawing as it plays)
  for (let i = 0; i < viewSamples; i += step){
    const idx = startIdx + i;
    const sample = waveform[Math.min(waveform.length-1, Math.max(0, idx))] || 0;
    const x = map(i, 0, viewSamples, 0, canvWidth);
    const halfH = map(Math.abs(sample), 0, .25, 0, canvHeight/2);
    const sampleTime = startTime + (i / viewSamples) * visibleDuration;
    if (sampleTime <= currentTimeInSeconds){
      stroke(255);
      // center-up bar
      line(x, canvHeight/2, x, (canvHeight/2) - halfH);
      // bottom-up bar
      line(x, canvHeight, x, canvHeight - halfH);
    }
  }
  // restore fill/stroke
  noStroke();

  // draw center horizontal line
  strokeWeight(1);
  line(0, canvHeight/2, canvWidth, canvHeight/2);

  // draw playhead
  pX = map(currentTimeInSeconds, startTime, endTime, 0, canvWidth);
  pY = map(amplitude.getLevel(),0, .25, canvHeight/2,0 );
  strokeWeight(1);
  line(pX, canvHeight/2, pX, pY);
  line(pX, canvHeight, pX, (canvHeight/2)+pY);

  // draw timestamps below center line
  noStroke();
  fill(255);
  textSize(12);
  // left start time
  textAlign(LEFT, TOP);
  text(formatTime(startTime), 4, canvHeight/2 + 6);
  // right end time and current/total to its left
  const endLabel = formatTime(endTime);
  const curLabel = formatTime(currentTimeInSeconds) + ' / ' + formatTime(durationInSeconds);
  textSize(12);
  textAlign(RIGHT, TOP);
  const endW = textWidth(endLabel);
  // draw current/total to the left of endLabel with 8px padding
  text(curLabel, canvWidth - 4 - endW - 8, canvHeight/2 + 6);
  // draw end label at right edge
  text(endLabel, canvWidth - 4, canvHeight/2 + 6);
}

function windowResized() {
  canvWidth = $("#my-p5-container").width();
  canvHeight = $("#my-p5-container").height();
  resizeCanvas(canvWidth, canvHeight);
  // restore proper background after resize
  background(cBackground);
  // redraw will happen in draw()
}


$( document ).ready(function() {
  canvWidth = $("#my-p5-container").width();
  canvHeight = $("#my-p5-container").height();
 

  $("#play").click(function(){
    play()
    
  })

  const container = document.getElementById('my-p5-container');

  // Create scrubber elements inside the container
  const scrubberLine = document.createElement('div');
  scrubberLine.id = 'scrubber-line';
  const scrubberTimestamp = document.createElement('div');
  scrubberTimestamp.id = 'scrubber-timestamp';
  if (container) {
    container.appendChild(scrubberLine);
    container.appendChild(scrubberTimestamp);
    console.log('Scrubber elements appended:', scrubberLine, scrubberTimestamp);
  }

  // Show scrubber on hover, move with cursor, hide on leave
  if (container) {
    container.addEventListener('mouseenter', function(){
      scrubberLine.style.display = 'block';
      scrubberTimestamp.style.display = 'block';
      console.log('scrubber show');
    });
    container.addEventListener('mouseleave', function(){
      scrubberLine.style.display = 'none';
      scrubberTimestamp.style.display = 'none';
      console.log('scrubber hide');
    });

    container.addEventListener('mousemove', function(e){
      // log to help debug p5 redraw interactions
      // console.log('scrubber mousemove', e.clientX, e.clientY);
      // compute mouse x relative to container
      const rect = container.getBoundingClientRect();
      const x = Math.min(Math.max(0, e.clientX - rect.left), rect.width);
      // position scrubber
      scrubberLine.style.left = (x - 1) + 'px';
      // timestamp to the right of cursor
      const tsLeft = Math.min(rect.width - 10, x + 12);
      scrubberTimestamp.style.left = tsLeft + 'px';
      scrubberTimestamp.style.top = '8px';
      // update time display
      if (durationInSeconds && durationInSeconds > 0){
        const timeAtCursor = visibleStartTime + (x / rect.width) * (visibleEndTime - visibleStartTime);
        scrubberTimestamp.textContent = formatTime(timeAtCursor);
        // console.log('timeAtCursor', timeAtCursor);
      } else {
        scrubberTimestamp.textContent = '0:00';
      }
    });

    // Click to seek and play at cursor position
    container.addEventListener('click', function(e){
      console.log('container click for seek');
      const rect = container.getBoundingClientRect();
      const x = Math.min(Math.max(0, e.clientX - rect.left), rect.width);
      if (!durationInSeconds || durationInSeconds <= 0) return;
      const timeAtCursor = visibleStartTime + (x / rect.width) * (visibleEndTime - visibleStartTime);

      console.log('seeking to', timeAtCursor);

      // If the SoundFile supports jump, use it; otherwise play from cue
      if (typeof mySound.jump === 'function'){
        try{ mySound.jump(timeAtCursor); }catch(err){
          try{ mySound.play(undefined, undefined, undefined, timeAtCursor); }catch(e){}
        }
      } else {
        try{ mySound.play(undefined, undefined, undefined, timeAtCursor); }catch(err){}
      }

      // update play state and backgrounds
      isPlaying = -1;
      cBackground = 0;
      $("#play").text("Pause");
      background(cBackground);
      wavelength();
      container.style.background = 'black';
    });
  }

  // Fullscreen toggle button behavior
  const fsBtn = document.getElementById('fullscreen-toggle');
  const fsIcon = fsBtn && fsBtn.querySelector('.material-icons');

  if (fsBtn) {
    fsBtn.addEventListener('click', async function(e){
      e.stopPropagation();
      if (!document.fullscreenElement) {
        try{
          await container.requestFullscreen();
        }catch(err){
          console.warn('Failed to enter fullscreen:', err);
        }
      } else {
        try{
          await document.exitFullscreen();
        }catch(err){
          console.warn('Failed to exit fullscreen:', err);
        }
      }
    });

    document.addEventListener('fullscreenchange', function(){
      if (document.fullscreenElement === container) {
        fsIcon.textContent = 'fullscreen_exit';
        // ensure canvas and container show playing/paused background correctly
        container.style.background = (cBackground === 0) ? 'black' : 'rgb(220,220,220)';
        // resize and redraw to avoid white flash
        windowResized();
      } else {
        fsIcon.textContent = 'fullscreen';
        container.style.background = (cBackground === 0) ? 'black' : 'rgb(220,220,220)';
        windowResized();
      }
    });
  }

  // Zoom buttons
  const zoomInBtn = document.getElementById('zoom-in');
  const zoomOutBtn = document.getElementById('zoom-out');
  if (zoomInBtn) zoomInBtn.addEventListener('click', function(e){
    e.stopPropagation();
    const cur = Math.min(maxZoom, zoomTarget * 2);
    zoomTarget = cur;
    zoomCenter = mySound.currentTime() || zoomCenter;
    console.log('zoom in ->', zoomTarget);
  });
  if (zoomOutBtn) zoomOutBtn.addEventListener('click', function(e){
    e.stopPropagation();
    const cur = Math.max(minZoom, zoomTarget / 2);
    zoomTarget = cur;
    zoomCenter = mySound.currentTime() || zoomCenter;
    console.log('zoom out ->', zoomTarget);
  });

  // Hide scrubber while hovering or focusing controls
  const controlsOverlay = document.querySelector('.controls-overlay');
  if (controlsOverlay && typeof scrubberLine !== 'undefined'){
    const hideScrubber = () => {
      try{
        scrubberLine.style.display = 'none';
        scrubberTimestamp.style.display = 'none';
      }catch(e){}
    }
    const restoreScrubber = () => {
      try{
        // only show if cursor is over container
        if (container && container.matches(':hover')){
          scrubberLine.style.display = 'block';
          scrubberTimestamp.style.display = 'block';
        }
      }catch(e){}
    }

    controlsOverlay.addEventListener('mouseenter', hideScrubber);
    controlsOverlay.addEventListener('mouseleave', restoreScrubber);
    controlsOverlay.addEventListener('focusin', hideScrubber);
    controlsOverlay.addEventListener('focusout', restoreScrubber);
  }


});

