const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const rooms = {};

// 公開用のルームリストを作成（パスワードの有無や人数を整理）
function getPublicRoomList() {
    return Object.values(rooms).map(r => ({
        id: r.id,
        playerCount: r.players.length,
        hasPassword: r.password !== "",
        status: r.players.length >= 2 ? "満員" : "募集中"
    }));
}

io.on("connection", (socket) => {
    // 1. 接続した瞬間に最新のリストを送る
    socket.emit("updateRoomList", getPublicRoomList());

    // ルーム作成
    socket.on("createRoom", (data) => {
        const { roomId, password, settings } = data;
        if (rooms[roomId]) {
            socket.emit("error_msg", "そのルーム名は既に存在します。");
            return;
        }

        rooms[roomId] = {
            id: roomId,
            password: password || "",
            settings: settings,
            players: [socket.id],
            board: [],
            turn: 0,
            timer: null,
            timeLeft: settings.timeLimit === 'free' ? null : parseInt(settings.timeLimit),
            gameStarted: false
        };

        socket.join(roomId);
        socket.emit("roomJoined", { roomId, playerIndex: 0 });
        
        // 重要：作成されたことを「全員」に通知
        io.emit("updateRoomList", getPublicRoomList());
    });

    // ルーム入室
    socket.on("joinRoom", (data) => {
        const { roomId, password } = data;
        const room = rooms[roomId];

        if (!room) {
            socket.emit("error_msg", "ルームが見つかりません。");
            return;
        }
        if (room.players.length >= 2) {
            socket.emit("error_msg", "満員です。");
            return;
        }
        if (room.password !== "" && room.password !== password) {
            socket.emit("error_msg", "パスワードが違います。");
            return;
        }

        room.players.push(socket.id);
        socket.join(roomId);

        socket.emit("roomJoined", { roomId, playerIndex: 1 });
        room.gameStarted = true;
        io.to(roomId).emit("gameStart");
        
        // 重要：入室があった（満員になった等）ことを「全員」に通知
        io.emit("updateRoomList", getPublicRoomList());
        startRoomTimer(roomId);
    });

    // 駒の配置
    socket.on("placePiece", (data) => {
        const { roomId, piece, consecutivePairs } = data;
        const room = rooms[roomId];
        if (!room || !room.gameStarted) return;

        room.board.push(piece);
        room.turn = 1 - room.turn;

        io.to(roomId).emit("moveMade", {
            piece,
            nextTurn: room.turn,
            consecutivePairs
        });
        startRoomTimer(roomId);
    });

    // 勝利宣言
    socket.on("declareWin", (data) => {
        const { roomId, winner } = data;
        const room = rooms[roomId];
        if (room) {
            if (room.timer) clearInterval(room.timer);
            room.gameStarted = false;
            io.to(roomId).emit("gameOver", { winner, reason: "checkmate" });
        }
    });

    function startRoomTimer(rid) {
        const room = rooms[rid];
        if (!room || room.settings.timeLimit === 'free') return;
        if (room.timer) clearInterval(room.timer);

        room.timeLeft = parseInt(room.settings.timeLimit);
        io.to(rid).emit("timerUpdate", room.timeLeft);

        room.timer = setInterval(() => {
            room.timeLeft--;
            io.to(rid).emit("timerUpdate", room.timeLeft);
            if (room.timeLeft <= 0) {
                clearInterval(room.timer);
                room.gameStarted = false;
                io.to(rid).emit("gameOver", { winner: 1 - room.turn, reason: "timeout" });
            }
        }, 1000);
    }

    // 切断処理
    socket.on("disconnect", () => {
        for (const rid in rooms) {
            if (rooms[rid].players.includes(socket.id)) {
                if (rooms[rid].timer) clearInterval(rooms[rid].timer);
                io.to(rid).emit("playerLeft");
                delete rooms[rid];
                // 重要：ルームが消えたことを「全員」に通知
                io.emit("updateRoomList", getPublicRoomList());
                break;
            }
        }
    });
});

server.listen(process.env.PORT || 3000);



