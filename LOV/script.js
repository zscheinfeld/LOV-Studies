
let mySound;
var cBackground = 220;
var isPlaying = 1
var canvWidth;
var canvHeight;
var durationInSeconds;
var pX;
var pY;

function preload() {
  // Load the sound file into the variable
  mySound = loadSound('sample.mp3'); 
}

function setup() {
 
    // Create the canvas
  let myCanvas = createCanvas(canvWidth, canvHeight); 
    // Attach the canvas to the div with the ID "my-p5-container"
  myCanvas.parent('my-p5-container'); 
  amplitude = new p5.Amplitude();
  durationInSeconds = mySound.duration()
  console.log(durationInSeconds);
  // Example: Play the sound when the sketch starts
  // mySound.play(); 
  background(cBackground)
}

function draw() {
  
  // console.log(amplitude.getLevel())
  let currentTimeInSeconds = mySound.currentTime(); 
  console.log(currentTimeInSeconds)
  pX=map(currentTimeInSeconds,0, durationInSeconds, 0, canvWidth) 
  pY=map(amplitude.getLevel(),0, .25, canvHeight/2,0 ) 
  strokeWeight(1);
  stroke(255);
  line(0, canvHeight/2, canvWidth, canvHeight/2)
  point(pX, pY);
  point(pX, (canvHeight/2)+pY);
  

}

function windowResized() {
  canvWidth = $("#my-p5-container").width();
  canvHeight = $("#my-p5-container").height();
  resizeCanvas(canvWidth, canvHeight);
}


$( document ).ready(function() {
  canvWidth = $("#my-p5-container").width();
  canvHeight = $("#my-p5-container").height();
 

  $("#play").click(function(){
    isPlaying = isPlaying * -1
    console.log( "click" );
    if (isPlaying == -1){
      mySound.play();
      cBackground  = 0;
      $("#play").text("Pause")
    }

    if (isPlaying == 1){
      mySound.pause();
      cBackground  = 220;
      $("#play").text("Play")
    }
    background(cBackground );

  })

  $("#my-p5-container").click(function(){
    isPlaying = isPlaying * -1
    console.log( "click" );
    if (isPlaying == -1){
      mySound.play();
      cBackground  = 0;
      $("#play").text("Pause")
    }

    if (isPlaying == 1){
      mySound.pause();
      cBackground  = 220;
      $("#play").text("Play")
    }
    background(cBackground );

  })


});

