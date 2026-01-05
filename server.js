const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const rooms = {};

io.on("connection", (socket) => {
    // ルーム作成（重複禁止）
    socket.on("createRoom", ({ roomId, settings }) => {
        if (rooms[roomId]) {
            socket.emit("error_msg", "そのルーム名は既に使用されています。");
            return;
        }
        rooms[roomId] = {
            id: roomId,
            players: [socket.id],
            settings: settings,
            board: [],
            turn: 0,
            timer: null,
            timeLeft: settings.timeLimit === 'free' ? null : parseInt(settings.timeLimit),
            consecutivePairs: [0, 0]
        };
        socket.join(roomId);
        socket.emit("roomJoined", { roomId, playerIndex: 0, settings });
    });

    // ルーム参加（確実な同期）
    socket.on("joinRoom", (roomId) => {
        const room = rooms[roomId];
        if (!room) {
            socket.emit("error_msg", "ルームが見つかりません。");
            return;
        }
        if (room.players.length >= 2) {
            socket.emit("error_msg", "満員です。");
            return;
        }

        room.players.push(socket.id);
        socket.join(roomId);
        // 参加者に初期情報を送る
        socket.emit("roomJoined", { roomId, playerIndex: 1, settings: room.settings });
        // 両者にゲーム開始を通知（これで相手方の画面も切り替わります）
        io.to(roomId).emit("gameStart");
        startTimer(roomId);
    });

    // 指し手の同期
    socket.on("placePiece", ({ roomId, piece, consecutivePairs }) => {
        const room = rooms[roomId];
        if (!room) return;
        
        room.board.push(piece);
        room.turn = 1 - room.turn;
        room.consecutivePairs = consecutivePairs;

        io.to(roomId).emit("moveMade", { 
            piece, 
            nextTurn: room.turn, 
            consecutivePairs: room.consecutivePairs 
        });
        
        startTimer(roomId);
    });

    // 勝敗宣言
    socket.on("declareWin", ({ roomId, winner }) => {
        if (rooms[roomId]) {
            if (rooms[roomId].timer) clearInterval(rooms[roomId].timer);
            io.to(roomId).emit("gameOver", { winner, reason: "checkmate" });
        }
    });

    // タイマー管理（時間切れ敗北の実装）
    function startTimer(roomId) {
        const room = rooms[roomId];
        if (!room || room.settings.timeLimit === 'free') return;

        if (room.timer) clearInterval(room.timer);
        room.timeLeft = parseInt(room.settings.timeLimit);
        io.to(roomId).emit("timerUpdate", room.timeLeft);

        room.timer = setInterval(() => {
            room.timeLeft--;
            io.to(roomId).emit("timerUpdate", room.timeLeft);
            if (room.timeLeft <= 0) {
                clearInterval(room.timer);
                const winner = 1 - room.turn;
                io.to(roomId).emit("gameOver", { winner, reason: "timeout" });
            }
        }, 1000);
    }

    socket.on("disconnect", () => {
        for (const rid in rooms) {
            if (rooms[rid].players.includes(socket.id)) {
                if (rooms[rid].timer) clearInterval(rooms[rid].timer);
                io.to(rid).emit("playerLeft");
                delete rooms[rid];
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server started on port ${PORT}`));
