const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const rooms = {};

// 公開用のルーム情報を整理して取得する関数
function getPublicRooms() {
    return Object.values(rooms).map(r => ({
        id: r.id,
        playerCount: r.players.length,
        hasPass: !!r.password,
        status: r.players.length >= 2 ? "満員" : "待機中"
    }));
}

io.on("connection", (socket) => {
    // 接続した瞬間に現在のルームリストを送信
    socket.emit("roomList", getPublicRooms());

    // ルーム作成
    socket.on("createRoom", ({ roomId, password, settings }) => {
        if (rooms[roomId]) {
            return socket.emit("error_msg", "そのルーム名は既に存在します。");
        }
        rooms[roomId] = {
            id: roomId,
            password: password,
            players: [socket.id],
            settings: settings,
            board: [],
            turn: 0,
            timer: null,
            timeLeft: settings.timeLimit === 'free' ? null : parseInt(settings.timeLimit),
            gameStarted: false
        };
        socket.join(roomId);
        socket.emit("roomJoined", { roomId, playerIndex: 0 });
        io.emit("roomList", getPublicRooms()); // 全員にリスト更新を通知
    });

    // ルーム参加
    socket.on("joinRoom", ({ roomId, password }) => {
        const room = rooms[roomId];
        if (!room) return socket.emit("error_msg", "ルームが見つかりません。");
        if (room.players.length >= 2) return socket.emit("error_msg", "満員です。");
        if (room.password && room.password !== password) return socket.emit("error_msg", "パスワードが正しくありません。");

        room.players.push(socket.id);
        socket.join(roomId);
        room.gameStarted = true; // 2人揃ったので開始
        
        socket.emit("roomJoined", { roomId, playerIndex: 1 });
        io.to(roomId).emit("gameStart");
        io.emit("roomList", getPublicRooms());
        
        startTimer(roomId);
    });

    // 駒の配置
    socket.on("placePiece", (data) => {
        const room = rooms[data.roomId];
        // 2人揃っていない、または終了している場合は無視
        if (!room || !room.gameStarted) return;

        room.board.push(data.piece);
        room.turn = 1 - room.turn; // ターン交代

        io.to(data.roomId).emit("moveMade", { 
            piece: data.piece, 
            nextTurn: room.turn, 
            consecutivePairs: data.consecutivePairs 
        });

        startTimer(data.roomId);
    });

    // 勝利宣言
    socket.on("declareWin", (data) => {
        const room = rooms[data.roomId];
        if (room) {
            clearInterval(room.timer);
            room.gameStarted = false;
            io.to(data.roomId).emit("gameOver", { winner: data.winner, reason: "checkmate" });
        }
    });

    // タイマー管理
    function startTimer(rid) {
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
                // 時間切れの場合、現在の手番ではない方の勝利
                io.to(rid).emit("gameOver", { winner: 1 - room.turn, reason: "timeout" });
            }
        }, 1000);
    }

    // 切断
    socket.on("disconnect", () => {
        for (const rid in rooms) {
            if (rooms[rid].players.includes(socket.id)) {
                clearInterval(rooms[rid].timer);
                io.to(rid).emit("playerLeft");
                delete rooms[rid];
                io.emit("roomList", getPublicRooms());
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));

