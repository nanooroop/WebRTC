//requiring libraries
const fs = require('fs');
const express = require('express');
const app = express();
const SocketIOFile = require('socket.io-file');
const path = require('path');

var privateKey = fs.readFileSync('certificates/key.pem', 'utf8');
var certificate = fs.readFileSync('certificates/cert.pem', 'utf8');

var credentials = {key: privateKey, cert:certificate};

var https = require('https').Server(credentials, app);;
var io = require('socket.io')(https);

var chatUploadFilePath = "public/dataChat_vidConf/";
var fileUploadCount = 0;
var clientFileDB = {};
var videoStreamsDB = {};    
var maxClients = 4;
//static hosting using express
app.set('view engine', 'pug')
app.set('views', path.join(__dirname, '/public'));


app.use(express.static('public'));

app.get('/:streamingName', function(req, res){
    res.render('index2', {streamingName : req.param.streamingName});
});

//signaling handlers
io.on('connection', function(socket){
    console.log('a user connected');
    

    //when client emits create or join
    socket.on('create or join', function(room){
        console.log('create or join', room);
        
        if(videoStreamsDB[room]){
            socket.emit('error_stream', 'Error! please select another room name. There already exists a room with this name in the system');
            return;
        }


        //count number of users on room
        var myRoom = io.sockets.adapter.rooms[room]||{length:0};
        var numClients = myRoom.length;
        console.log('Room ', room, ' has ', numClients, ' clients');
        
        if(numClients < maxClients){
            socket.join(room);
            socket.emit('create', room, socket.id, numClients != 0 ? Object.keys(myRoom.sockets) : []);
        }else{
            socket.emit('full', room);
        }
    });
    
    socket.on('con_offer', function(room, fromID, toID, data){
        socket.broadcast.to(room).emit('con_offer', room, fromID, toID, data);
    });

    socket.on('con_answer', function(room, fromID, toID, data){
        socket.broadcast.to(room).emit('con_answer', room, fromID, toID, data);
    });

    socket.on('con_candidate', function(room, fromID, toID, data){
        socket.broadcast.to(room).emit('con_candidate', room, fromID, toID, data);
    });

    socket.on('chat_message', function(room, fromID, message){
        socket.broadcast.to(room).emit("chat_message", room, fromID, message);
    });

    socket.on('disconnect', function(){
        // when the client disconnects from the session

        io.sockets.emit('disconnect', socket.id);
        // delete all the file which are uploaded by the client
        // when he disconnects.
        var streamingChannels = Object.keys(videoStreamsDB);

        for(var i = 0; i < streamingChannels.length; i++){
            //console.log(videoStreamsDB);
            if(videoStreamsDB[streamingChannels[i]].source == socket.id){
                delete videoStreamsDB[streamingChannels[i]];
            }
        }

        var clientFiles = clientFileDB[socket.id];
        if(!clientFiles){return;}
        for(var i = 0; i < clientFiles.length; i++){
            var element = clientFiles[i];
            fs.unlink(chatUploadFilePath + element, function(){});
        }

    })


    // File upload system.
    var uploader = new SocketIOFile(socket, {
        uploadDir: chatUploadFilePath,				
        chunkSize: 10240,							
        transmissionDelay: 0,						
        overwrite: true, 							
        rename: function(filename, fileinfo){
            // renaming the file before it is stored in the database
            var file = path.parse(filename);
            var fname = file.name;
            var ext = file.ext;
            return `${fname}_${socket.id}_${fileUploadCount++}.${ext}`;
        }
    });

    // when the file uploading start
    uploader.on('start', (fileInfo) => {
        console.log('Start uploading');
        console.log(fileInfo);
    });
    
    // when the file starts streaming to the server
    uploader.on('stream', (fileInfo) => {
        console.log(`${fileInfo.wrote} / ${fileInfo.size} byte(s)`);
    });

    // when the file upload had be completed
    uploader.on('complete', (fileInfo) => {
        console.log('Upload Complete.');
        console.log(fileInfo);
        // keeping track of which file is uploaded by which client
        if(clientFileDB[socket.id]){
            clientFileDB[socket.id].push(fileInfo.name);
        }else{
            clientFileDB[socket.id] = [fileInfo.name];
        }
    });

    // when the file uploading encounters an error
    uploader.on('error', (err) => {
        console.log('Error!', err);
    });

    // when the file uploading is aborted
    uploader.on('abort', (fileInfo) => {
        console.log('Aborted: ', fileInfo);
    });

    // video streaming system
    socket.on('create_stream',function(streamingName){
        // check if the the room name is available
        var myRoom = io.sockets.adapter.rooms[streamingName]||{length:0};
        var numClients = myRoom.length;
        if(videoStreamsDB[streamingName] || numClients != 0){
            socket.emit('error_stream', 'Error! This streaming name has already been taken please pick a new name.');
            return;
        }
        videoStreamsDB[streamingName] = {
            source : socket.id,
            clients : [],
        };
        socket.join(streamingName);
        socket.emit('create_stream', streamingName);
        
    })

    // when the server receives the join stream command
    socket.on('join_stream', function(streamingName_to_connect){
        // HERE streamingName_to_connect == channel
        var channel = streamingName_to_connect;
        if(!videoStreamsDB[channel]){
            socket.emit('error_stream', 'Error! Cannot connect to a channel which does not exist. Please, try a valid channel name');
        }else{
            videoStreamsDB[channel].clients.push(socket.id);
            socket.join(channel);
            socket.broadcast.to(channel).emit('request_join_stream', channel, socket.id, videoStreamsDB[channel].source);
        }
    })

    // when the server receives the offer of the streaming entity
    socket.on('con_offer_stream', function(channel, fromID, toID, data){
        socket.broadcast.to(channel).emit('con_offer_stream', channel, fromID, toID, data);
    });

    // when the server receives the answer from the receiver entity
    socket.on('con_answer_stream', function(channel, fromID, toID, data){
        socket.broadcast.to(channel).emit('con_answer_stream', channel, fromID, toID, data);
    });

});

var LANAccess = "0.0.0.0";
//listener
https.listen(3000, LANAccess);
console.log('listening on https://localhost:3000');
