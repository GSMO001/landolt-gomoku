const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

// ルーム情報を保持するオブジェクト
const rooms = {};

// 公開可能なルーム一覧を作成するヘルパー関数
function getPublicRoomList() {
    return Object.values(rooms).map(r => {
        return {
            id: r.id,
            playerCount: r.players.length,
            hasPassword: r.password !== "",
            status: r.players.length >= 2 ? "対局中" : "待機中"
        };
    });
}

io.on("connection", (socket) => {
    console.log("A user connected:", socket.id);

    // 接続時に現在のルーム一覧を送信
    socket.emit("updateRoomList", getPublicRoomList());

    // ルーム作成処理
    socket.on("createRoom", (data) => {
        const { roomId, password, settings } = data;

        if (rooms[roomId]) {
            socket.emit("error_msg", "そのルーム名は既に使われています。");
            return;
        }

        rooms[roomId] = {
            id: roomId,
            password: password || "",
            settings: settings, // timeLimitなど
            players: [socket.id],
            board: [],
            turn: 0, // 0: 黒, 1: 白
            timer: null,
            timeLeft: settings.timeLimit === 'free' ? null : parseInt(settings.timeLimit),
            gameStarted: false
        };

        socket.join(roomId);
        socket.emit("roomJoined", { roomId: roomId, playerIndex: 0 });
        
        // 全ユーザーのロビー画面を更新
        io.emit("updateRoomList", getPublicRoomList());
    });

    // ルーム参加処理
    socket.on("joinRoom", (data) => {
        const { roomId, password } = data;
        const room = rooms[roomId];

        if (!room) {
            socket.emit("error_msg", "ルームが見つかりません。");
            return;
        }
        if (room.players.length >= 2) {
            socket.emit("error_msg", "このルームは満員です。");
            return;
        }
        if (room.password !== "" && room.password !== password) {
            socket.emit("error_msg", "パスワードが正しくありません。");
            return;
        }

        room.players.push(socket.id);
        socket.join(roomId);

        // 参加者に通知
        socket.emit("roomJoined", { roomId: roomId, playerIndex: 1 });

        // 2人揃ったのでゲーム開始
        room.gameStarted = true;
        io.to(roomId).emit("gameStart");
        
        // ロビー一覧の更新
        io.emit("updateRoomList", getPublicRoomList());

        // タイマー開始
        startRoomTimer(roomId);
    });

    // 駒が置かれた時の処理
    socket.on("placePiece", (data) => {
        const { roomId, piece, consecutivePairs } = data;
        const room = rooms[roomId];

        if (!room || !room.gameStarted) return;

        // 盤面情報を更新
        room.board.push(piece);
        
        // ターンを交代 (0 <-> 1)
        room.turn = 1 - room.turn;

        // 全員に指し手を通知
        io.to(roomId).emit("moveMade", {
            piece: piece,
            nextTurn: room.turn,
            consecutivePairs: consecutivePairs
        });

        // タイマーをリセットして再開
        startRoomTimer(roomId);
    });

    // 勝利宣言
    socket.on("declareWin", (data) => {
        const { roomId, winner, reason } = data;
        const room = rooms[roomId];
        if (room) {
            if (room.timer) clearInterval(room.timer);
            room.gameStarted = false;
            io.to(roomId).emit("gameOver", { winner: winner, reason: reason || "checkmate" });
        }
    });

    // タイマー管理関数
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
                // 時間切れの場合、現在の手番でない方が勝利
                const winner = 1 - room.turn;
                io.to(rid).emit("gameOver", { winner: winner, reason: "timeout" });
            }
        }, 1000);
    }

    // 切断時の処理
    socket.on("disconnect", () => {
        for (const rid in rooms) {
            if (rooms[rid].players.includes(socket.id)) {
                if (rooms[rid].timer) clearInterval(rooms[rid].timer);
                io.to(rid).emit("playerLeft");
                delete rooms[rid];
                io.emit("updateRoomList", getPublicRoomList());
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});


