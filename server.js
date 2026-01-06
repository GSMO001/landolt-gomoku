const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map();

function broadcastRoomUpdate() {
    const list = Array.from(rooms.values()).map(r => ({
        id: r.id,
        playerCount: r.players.length,
        hasPw: r.password !== "",
        status: r.gameStarted ? "PLAYING" : "OPEN",
        timeLimit: r.settings.timeLimit
    }));
    io.emit("updateRoomList", list);
}

io.on("connection", (socket) => {
    // 接続時にルーム一覧を送付
    socket.emit("updateRoomList", Array.from(rooms.values()).map(r => ({
        id: r.id, playerCount: r.players.length, hasPw: r.password !== "",
        status: r.gameStarted ? "PLAYING" : "OPEN", timeLimit: r.settings.timeLimit
    })));

    socket.on("createRoom", (data) => {
        if (!data.roomId || rooms.has(data.roomId)) {
            return socket.emit("error_msg", "ルーム名が無効または既に使用されています。");
        }
        const room = {
            id: data.roomId,
            password: data.password || "",
            settings: { timeLimit: parseInt(data.timeLimit) || 60 },
            players: [socket.id],
            board: [],
            turn: 0,
            gameStarted: false,
            pairCounts: [0, 0],
            timeLeft: parseInt(data.timeLimit) || 60,
            timer: null
        };
        rooms.set(data.roomId, room);
        socket.join(data.roomId);
        socket.emit("roomJoined", { roomId: data.roomId, playerIndex: 0, timeLimit: room.settings.timeLimit });
        broadcastRoomUpdate();
    });

    socket.on("joinRoom", (data) => {
        const room = rooms.get(data.roomId);
        if (room && room.players.length < 2) {
            if (room.password !== "" && room.password !== data.password) return socket.emit("error_msg", "パスワードが違います。");
            room.players.push(socket.id);
            socket.join(data.roomId);
            socket.emit("roomJoined", { roomId: data.roomId, playerIndex: 1, timeLimit: room.settings.timeLimit });
            room.gameStarted = true;
            io.to(data.roomId).emit("gameStart");
            startTimer(data.roomId);
            broadcastRoomUpdate();
        } else {
            socket.emit("error_msg", "ルームが見つからないか満員です。");
        }
    });

    function startTimer(roomId) {
        const room = rooms.get(roomId);
        if (!room) return;
        if (room.timer) clearInterval(room.timer);
        room.timeLeft = room.settings.timeLimit;
        
        room.timer = setInterval(() => {
            room.timeLeft--;
            io.to(roomId).emit("timerUpdate", { timeLeft: room.timeLeft, turn: room.turn });
            if (room.timeLeft <= 0) {
                clearInterval(room.timer);
                const winner = 1 - room.turn;
                io.to(roomId).emit("gameOver", { winner, reason: "TIMEOUT" });
                rooms.delete(roomId);
                broadcastRoomUpdate();
            }
        }, 1000);
    }

    socket.on("placePiece", (data) => {
        const room = rooms.get(data.roomId);
        if (!room || room.players[room.turn] !== socket.id) return;
        
        room.board.push(data.piece);
        room.pairCounts = data.consecutivePairs;
        room.turn = 1 - room.turn;
        
        startTimer(data.roomId); // ターン交代時にタイマーリセット
        io.to(data.roomId).emit("moveMade", { 
            piece: data.piece, 
            nextTurn: room.turn, 
            consecutivePairs: room.pairCounts 
        });
    });

    socket.on("declareWin", (data) => {
        const room = rooms.get(data.roomId);
        if (room) {
            if (room.timer) clearInterval(room.timer);
            io.to(data.roomId).emit("gameOver", { winner: data.winner, reason: "WIN" });
            rooms.delete(data.roomId);
            broadcastRoomUpdate();
        }
    });

    socket.on("disconnect", () => {
        for (const [id, room] of rooms) {
            if (room.players.includes(socket.id)) {
                if (room.timer) clearInterval(room.timer);
                io.to(id).emit("playerLeft");
                rooms.delete(id);
                broadcastRoomUpdate();
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));


