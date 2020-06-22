//here we get a reference to the webpage elements
var divSelectRoom = document.getElementById("selectRoom");
var divConsultingRoom = document.getElementById("consultingRoom");
var inputRoomNumber = document.getElementById("roomNumber");
var inputStreamingName = document.getElementById("streamingName");
var btnGoRoom = document.getElementById("goRoom");
var btnGoStreaming = document.getElementById("goStreaming");
var btnGoStreaming_localVideo = document.getElementById("goStreaming_local_video");
var localVideo = document.getElementById("localVideo");
var fileUploadForm = document.getElementById("file-upload-form");

//these are the global variables
var streamingName;
var roomNumber;
var localStream;
var remoteStreams = {};
var _connections = {};  // all the rtc connections
var currentRemoteConnections = 0;
var maxRecordingTimeMS = 300000;  // DEFAULT maximun recording time of a video stream in Milliseconds
var isStreamingLocalVideo = false; 
var isVideoConference = false; 
var socketID = null;

var rtcPeerConnection;
//these are the STUN servers
var iceServers={
    'iceServers':[
        {'urls':'stun:stun.services.mozilla.com'},
        {'urls':'stun:stun.1.google.com:19302'},
        {
            'urls': 'turn:numb.viagenie.ca',
            'username' : 'saxkwi12@outlook.com',
            'credential' : '123456',
        }
    ]
};
var streamConstraints = {audio:true, video:true};
var isCaller;

//Here we connect to the socket.io server
var socket = io();

//Here we add a click event to the button
btnGoRoom.onclick = function(){
    if (inputRoomNumber.value === ""){
        alert("Please type a room number");
    }else{
        roomNumber = inputRoomNumber.value;//we take the value from the element
        socket.emit('create or join', roomNumber);//we send a message to server
    }    
};

// when a new client joins the room
socket.on('create', function(room, id, clients){
    $('#video-conference-wrapper').removeClass('hide');
    divSelectRoom.style = "display:none";       //hide selectRoom div
    divConsultingRoom.style = "display:block";  //show consultingRoom div
    socketID = socket.id;
    $("#chat-name-input").val(socketID);
    isVideoConference = true;

    navigator.mediaDevices.getUserMedia(streamConstraints).then(function(stream){  
        // get and set local media stream
        localStream = stream;
        localVideo.srcObject = stream;

        attachRecorder(stream, "recording-local-video");

        if(clients.length < 2){return;}
        for(var i = 0; i < clients.length; i++){
            // for all the clients in a room except yourself
            var socketListID = clients[i];
            if(socketListID == socketID){continue;}
            let slid = socketListID;    
            if(!_connections[socketListID]){
                // when a new connection is created
                _connections[socketListID] = new RTCPeerConnection(iceServers);
                _connections[socketListID].onicecandidate = function(event){
                    // when this connection's candidates arrive
                    // send them to the other client who has been
                    // sent an offer by this connection.
                    if (event.candidate){
                        
                        socket.emit('con_candidate',
                            roomNumber, // my roomNumber
                            socketID,   // my socketID
                            slid,       // socketID of the target client
                            {
                                type:'candidate',
                                label:event.candidate.sdpMLineIndex,
                                id:event.candidate.sdpMid,
                                candidate:event.candidate.candidate,
                                room:roomNumber
                            }
                        );
                    }
                }

                _connections[socketListID].onaddstream = function(event){
                    // when a stream is added to the connection.
                    $("#consultingRoom").append(
                        makeRemoteVideoElement(currentRemoteConnections)
                    )
                    var _remoteVideo = document.getElementById("remoteVideo" + currentRemoteConnections);
                    _remoteVideo.srcObject = event.stream;
                    remoteStreams[slid] = {stream: event.stream, htmlVideoObject : $('.video-div-' + currentRemoteConnections)};
                    attachRecorder(event.stream, 'recording-remote-video-'+ currentRemoteConnections);
                    currentRemoteConnections += 1;
                };

                _connections[socketListID].addStream(localStream);
                
                _connections[socketListID].createOffer(function (sessionDescription){
                    // creating an offer and sending it to the 
                    // target client                    
                    _connections[slid].setLocalDescription(sessionDescription);
                    socket.emit('con_offer', roomNumber, socketID, slid, {
                        type:'offer',
                        sdp:sessionDescription,
                        room:roomNumber
                    });
                }, function(e){console.log(e);});
            }


        }

    }).catch(function(err){
    console.log("An error occured when accessing media devices");
    });

});

// when an offer from a newly connected client arrives
socket.on('con_offer', function(room, fromID, toID, data){

    if(toID != socketID){return;}
    if(_connections[fromID]){return;}
    let fid = fromID; 
    _connections[fromID] = new RTCPeerConnection(iceServers);
    _connections[fromID].onicecandidate = function(event){
        if (event.candidate){
            // when the candidates of this client arrive.
            // send them to the client who offered a webrtc connection
  
            socket.emit('con_candidate',
                roomNumber, // my room number  
                socketID,   // my socketID
                fid,        // socket id of target client who offered a connection
                {
                    type:'candidate',
                    label:event.candidate.sdpMLineIndex,
                    id:event.candidate.sdpMid,
                    candidate:event.candidate.candidate,
                    room:roomNumber
                }
            );
        }
    };
    _connections[fromID].onaddstream = function(event){
        // when a stream is added to the connection.
        $("#consultingRoom").append(
            makeRemoteVideoElement(currentRemoteConnections)
        )
        var _remoteVideo = document.getElementById("remoteVideo" + currentRemoteConnections);
        _remoteVideo.srcObject = event.stream;
        remoteStreams[fid] = {stream: event.stream, htmlVideoObject : $('.video-div-' + currentRemoteConnections)};
        attachRecorder(event.stream, 'recording-remote-video-'+ currentRemoteConnections);
        currentRemoteConnections += 1;
    };
    _connections[fromID].addStream(localStream);
    _connections[fromID].setRemoteDescription(new RTCSessionDescription(data.sdp));
    
    _connections[fromID].createAnswer(function (sessionDescription){
        // create an answer and send it to the target client who offered a connection
        _connections[fid].setLocalDescription(sessionDescription);
        socket.emit('con_answer',roomNumber, socketID, fid, {
            type:'answer',
            sdp:sessionDescription,
            room:roomNumber
        });
    }, function(e){console.log(e);});

});


// when the answer from the offering entity comes.
socket.on('con_answer', function(room, fromID, toID, data){
    console.log('con_answer')
    if(socketID != toID) {return;}
    _connections[fromID].setRemoteDescription(new RTCSessionDescription(data.sdp));
});



// when the candidata from the other connection arrives.
socket.on('con_candidate', function(room, fromID, toID, data){
    //create a candidate object
    if(socketID != toID) {return;}
    var candidate = new RTCIceCandidate({
        sdpMLineIndex:data.label,
        candidate:data.candidate
    });
    //stores candidate
    if(_connections[fromID]){
        _connections[fromID].addIceCandidate(candidate);
    }else{
        console.log('Error: fromID (' + fromID + ') does not exist in connections');
    }
});

socket.on('full', function(room){
    // when the max number of client have reached
    alert('Cannot connect to this room')
});

socket.on('disconnect', function(sid){
    if(!remoteStreams[sid]){return;}
    delete _connections[sid];
    remoteStreams[sid].htmlVideoObject.remove();
    delete remoteStreams[sid];
    delete _connections[sid]
});



//  when a chat message arrives from the server
socket.on('chat_message', function(room, fromID, message){
    updateChatMessageBox(message);
});

//  send a chat message to the server to be broadcasted and
//  a copy of it is also shown on the current client's page.
function sendChatMessage(){
    var chatMsg = $("#chat-message-input").val();
    if(chatMsg === ""){alert("Please enter a chat message...");return;}
    $("#chat-message-input").val("");
    var formatedMessage = {
        id: socketID,
        name: $("#chat-name-input").val() === "" ? socketID : $("#chat-name-input").val(),      // the public chat name 
        content: chatMsg,
    }
    socket.emit('chat_message', roomNumber, socketID, formatedMessage);
    updateChatMessageBox(formatedMessage);

}

//  update the message box in the HTML
function updateChatMessageBox(message){
    $("#chat-message-box").append(makeChatItem(message));
    var messageBody = document.querySelector('#chat-message-box');
    messageBody.scrollTop = messageBody.scrollHeight - messageBody.clientHeight;
}

//  HTML template for the chat message.
function makeChatItem(message){
    return `
        <div class="chat-item m-3" style="border-bottom:1px solid #ccc">
            <p class="mb-1" style="font-size:14px;color:#343434"><strong>` + message.name + `</strong></p>
            <p>` + message.content + `</p>
        </div>
    `;
}


//  This function makes the remote video element
//  as per unique id which is given.
function makeRemoteVideoElement(unique_id){
    var videoWidth = "";
    var videoHeight = "";
    if(isVideoConference){
        // if the video conference application is being used.
        var crHeight = $(window).innerHeight();
        var crWidth = $('#consultingRoom').innerWidth();

        var rvWidth = crWidth / 2 - 50;
        var rvHeight = crHeight / 2 - 100;
        
        videoHeight = "height='"+ rvHeight +"'";
       
        $("#localVideo").attr('height', rvHeight);
    }

    return `
    <div id="video-div" class="video-div-` + unique_id + `">
        <video class="mb-3" id="remoteVideo` + unique_id + `" autoplay ${videoHeight} ${videoWidth}></video>
        <button role="button" class="btn btn-primary" id="start-recording-remote-video-`+ unique_id +`">Start Recording</button>
        <button role="button" class="btn btn-danger hide" id="stop-recording-remote-video-`+ unique_id +`" >Stop Recording</button>
        <button role="button" class="btn btn-success hide" id="download-recording-remote-video-`+ unique_id +`" >Download Recording</button>
    </div>
    `;
}

function attachRecorder(stream, genericName){        
    let _stream = stream;   // scope specfic stream 
    let startBtn = $("#start-" + genericName);
    let stopBtn = $("#stop-" + genericName);
    let downloadBtn = $("#download-" + genericName);

    // when start button is clicked
    startBtn.on('click', function(){
        startBtn.addClass('hide');  
        // make the recorder object
        let recorder = RecordRTC(stream,{
            type : 'video',
        });
        // start recording of the video stream
        recorder.startRecording();
        // if the recording exceeds the max recording time the automatically 
        // stop recording and generate a download able file and set it to the
        // download link.
        let recorderTimeout = setTimeout(function(){
            stopBtn.addClass('hide');
            stopBtn.off('click');
            downloadBtn.removeClass('hide');
            recorder.stopRecording(function(){
                let blob = recorder.getBlob(); // scope level video content blob.
                // when the download button is clicked.
                downloadBtn.on('click', function(){
                    startBtn.removeClass('hide');
                    downloadBtn.addClass('hide');
                    downloadBtn.off('click');
                    invokeSaveAsDialog(blob);
                });
            });
        }, maxRecordingTimeMS);
        stopBtn.removeClass('hide');
        // if the stop button is clicked before the default timeout then
        // stop the recorder timeout adn download the video file. 
        stopBtn.on('click', function(){
            clearTimeout(recorderTimeout);
            recorder.stopRecording(function(){
                let blob = recorder.getBlob();
                BLOB = blob;
 
                invokeSaveAsDialog(blob);
                
                stopBtn.addClass('hide');
                stopBtn.off('click');
                startBtn.removeClass('hide');
            });
        })
    })
}

// the file upload system
var uploader = new SocketIOFileClient(socket);
 
// when the file starts uploading
uploader.on('start', function(fileInfo) {
    $('#file-upload-spinner').removeClass('hide');
    console.log('Start uploading', fileInfo);
});

// when the file starts to get streamed to the server
uploader.on('stream', function(fileInfo) {
    console.log('Streaming... sent ' + fileInfo.sent + ' bytes.');
});

uploader.on('complete', function(fileInfo) {
    $('#file-upload-spinner').addClass('hide');
    console.log('Upload Complete', fileInfo);
    var fname = fileInfo.name;
    var formatedMessage = {
        id: socketID,
        name: $("#chat-name-input").val() === "" ? socketID : $("#chat-name-input").val(),      // the public chat name 
        content: `<p>Download File: <a target="_blank" href="/dataChat_vidConf/` + fname + `">See File</a></p>`,
    }
    socket.emit('chat_message', roomNumber, socketID, formatedMessage);
    updateChatMessageBox(formatedMessage);
});

// when the file uploading encounters an error
uploader.on('error', function(err) {
    $('#file-upload-spinner').addClass('hide');
    alert('There was an error, while uploading the file. Please upload the file again');
    console.log('Error', err);
});

// when the file uploading gets aborted
uploader.on('abort', function(fileInfo) {
    $('#file-upload-spinner').addClass('hide');
    console.log('Aborted: ', fileInfo);
});

// when the file form gets submitted,
fileUploadForm.onsubmit = function(event){
    event.preventDefault();
    var fileEl = document.getElementById('to-upload-file');
    uploader.upload(fileEl);
};

// Video streaming system
String.prototype.count=function(s1) { 
    return (this.length - this.replace(new RegExp(s1,"g"), '').length) / s1.length;
}

// get the name of the streaming channel
function getStreamingName(){
    var pn = window.location.pathname;
    pn = pn.substr(1);
    if(pn == "") return null;
    if(pn.count('/') > 1) return null;
    return pn;
}

// button to create the streaming channel
btnGoStreaming.onclick = function(){
    if(inputStreamingName.value === ""){
        alert("Please type a room number");
    }else{
        streamingName = inputStreamingName.value;
        roomNumber = streamingName;
        socket.emit('create_stream', streamingName);
        isStreamingLocalVideo = false;
    }
}

// button to create the streaming channel if the user want to stream the local video.
if(btnGoStreaming_localVideo){
    btnGoStreaming_localVideo.onclick = function(){
        if(inputStreamingName.value === ""){
            alert("Please type a room number");
        }else if(!document.getElementById("videoFile2Stream").files[0]){
            alert("Please select a video file");
        }
        else{
            streamingName = inputStreamingName.value;
            roomNumber = streamingName;
            socket.emit('create_stream', streamingName);
            isStreamingLocalVideo = true;
        }
}
}

// if an error for streaming is received
socket.on("error_stream", function(error){
    alert(error);
}); 

// creating the stream
socket.on('create_stream', function(streamName){
    $('#video-conference-wrapper').removeClass('hide');
    divSelectRoom.style = "display:none";       //hide selectRoom div
    divConsultingRoom.style = "display:block";  //show consultingRoom div
    socketID = socket.id;
    $("#chat-name-input").val(socket.id);
    $(".localVideoDiv").attr('style', 'display:block !important');
    $("#localVideo").attr('style', 'width:100%;height:93vh');
    $('#chat-col').addClass('hide');
    $('#video-col').removeClass('col-lg-9 col-xl-9');

    $('.localVideoDiv').append('Streaming Channel is :    ' + window.location.href + streamName);

    if(isStreamingLocalVideo){
        var file = document.getElementById("videoFile2Stream").files[0];
        localVideo.src = URL.createObjectURL(file);
        if(navigator.userAgent.indexOf('Firefox') > -1){
            // using fire fox
            localStream = localVideo.mozCaptureStream();
        }else{
            // using other browser
            localStream = localVideo.captureStream();
        }
        attachRecorder(localStream, "recording-local-video");
        return;
    }

    navigator.mediaDevices.getUserMedia(streamConstraints).then(function(stream){  
        // get and set local media stream
        localStream = stream;
        localVideo.srcObject = stream;
        attachRecorder(stream, "recording-local-video");
        

    }).catch(function(err){
    console.log("An error occured when accessing media devices");
    });

});


// when a client requests to join the stream make an offer to it
socket.on('request_join_stream', function(_channel, _fromID, _toID){
    let socketID = socket.id;
    let fromID = _fromID;
    let toID = _toID;
    let channel = _channel;
    if(toID != socketID){return;}
    if(_connections[fromID]){return;}
    _connections[fromID] = new RTCPeerConnection(iceServers);
    _connections[fromID].onicecandidate = function(event){
        // when this connection's candidates arrive
        // send them to the other client who has been
        // sent an offer by this connection.
        if (event.candidate){
            
            socket.emit('con_candidate',
                channel,    // channel
                socketID,   // my socketID
                fromID,       // socketID of the target client
                {
                    type:'candidate',
                    label:event.candidate.sdpMLineIndex,
                    id:event.candidate.sdpMid,
                    candidate:event.candidate.candidate,
                    room:roomNumber
                }
            );
        }
    }
    _connections[fromID].addStream(localStream);
    _connections[fromID].createOffer(function (sessionDescription){
        // creating an offer and sending it to the 
        // target client                    
        _connections[fromID].setLocalDescription(sessionDescription);
        socket.emit('con_offer_stream', channel, socketID, fromID, {
            type:'offer',
            sdp:sessionDescription,
            room:channel
        });
    }, function(e){console.log(e);});

});


// when an offer from the streaming entity 
socket.on('con_offer_stream', function(_channel, _fromID, _toID, _data){
    let socketID = socket.id;
    let fromID = _fromID;
    let toID = _toID;
    let channel = _channel;
    let data = _data;
    if(toID != socketID){return;}
    if(_connections[fromID]){return;}
    _connections[fromID] = new RTCPeerConnection(iceServers);
    _connections[fromID].onicecandidate = function(event){
        if (event.candidate){
            // when the candidates of this client arrive.
            // send them to the client who offered a webrtc connection

            socket.emit('con_candidate',
                channel, // my room number  
                socketID,   // my socketID
                fromID,        // socket id of target client who offered a connection
                {
                    type:'candidate',
                    label:event.candidate.sdpMLineIndex,
                    id:event.candidate.sdpMid,
                    candidate:event.candidate.candidate,
                    room:roomNumber
                }
            );
        }
    };
    _connections[fromID].onaddstream = function(event){
        // when a stream is added to the connection.
        $("#consultingRoom").append(
            makeRemoteVideoElement(currentRemoteConnections)
        )
        var _remoteVideo = document.getElementById("remoteVideo" + currentRemoteConnections);
        _remoteVideo.srcObject = event.stream;
        remoteStreams[fromID] = {stream: event.stream, htmlVideoObject : $('.video-div-' + currentRemoteConnections)};
        attachRecorder(event.stream, 'recording-remote-video-'+ currentRemoteConnections);
        currentRemoteConnections += 1;
    };

    _connections[fromID].setRemoteDescription(new RTCSessionDescription(data.sdp));
    _connections[fromID].createAnswer(function (sessionDescription){
        // create an answer and send it to the target client who offered a connection
        _connections[fromID].setLocalDescription(sessionDescription);
        socket.emit('con_answer_stream',channel, socketID, fromID, {
            type:'answer',
            sdp:sessionDescription,
            room:channel
        });
    }, function(e){console.log(e);});



});

// when the answer from the offering entity comes.
socket.on('con_answer_stream', function(channel, fromID, toID, data){
    console.log('con_answer_stream')
    if(socketID != toID) {return;}
    _connections[fromID].setRemoteDescription(new RTCSessionDescription(data.sdp));
});


// when the window is loaded check if the url corresponds to that for the 
// joining with the streaming channel. If it is do the necessary work.
var streamName = getStreamingName();
if(streamName){
    roomNumber = streamName;
    streamingName = streamName;
    socket.emit('join_stream', streamName);
    $('#video-conference-wrapper').removeClass('hide');
    divSelectRoom.style = "display:none";       //hide selectRoom div
    divConsultingRoom.style = "display:block";  //show consultingRoom div
    $(".localVideoDiv").addClass('hide');
    $("#chat-messeger-input-box").addClass('hide');
}
