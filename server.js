/**
 * LANDOLT GOMOKU ONLINE - MASTER SERVER
 * 128x128 Board / Global Timer / Rule Validation
 */
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" },
    pingTimeout: 10000,
    pingInterval: 5000
});

app.use(express.static(path.join(__dirname, "public")));

// 全ルームの状態を管理
const rooms = new Map();

/**
 * ロビーにいる全員に最新のルーム状況を届ける
 */
function updateLobby() {
    const roomList = Array.from(rooms.values()).map(r => ({
        id: r.id,
        playerCount: r.players.length,
        hasPw: r.password !== "",
        status: r.gameStarted ? "PLAYING" : (r.players.length >= 2 ? "FULL" : "OPEN"),
        timeLimit: r.settings.timeLimit
    }));
    io.emit("lobbyUpdate", roomList);
}

io.on("connection", (socket) => {
    console.log(`New user connected: ${socket.id}`);

    // ルーム作成
    socket.on("createRoom", (data) => {
        const { roomId, password, timeLimit } = data;
        if (!roomId || rooms.has(roomId)) {
            return socket.emit("system_error", "ルーム名が正しくないか、既に存在します。");
        }

        const room = {
            id: roomId,
            password: password || "",
            settings: { timeLimit: parseInt(timeLimit) || 60 },
            players: [socket.id],
            board: [],
            turn: 0,
            gameStarted: false,
            pairCounts: [0, 0],
            timeLeft: parseInt(timeLimit) || 60,
            timerInterval: null
        };

        rooms.set(roomId, room);
        socket.join(roomId);
        socket.emit("joinSuccess", { roomId, playerIndex: 0, timeLimit: room.settings.timeLimit });
        updateLobby();
    });

    // ルーム参加
    socket.on("joinRoom", (data) => {
        const { roomId, password } = data;
        const room = rooms.get(roomId);

        if (!room) return socket.emit("system_error", "ルームが見つかりません。");
        if (room.players.length >= 2) return socket.emit("system_error", "このルームは満員です。");
        if (room.password !== "" && room.password !== password) {
            return socket.emit("system_error", "パスワードが一致しません。");
        }

        room.players.push(socket.id);
        socket.join(roomId);
        socket.emit("joinSuccess", { roomId, playerIndex: 1, timeLimit: room.settings.timeLimit });

        // 2人揃ったので開始
        room.gameStarted = true;
        io.to(roomId).emit("gameStartSignal");
        startGlobalTimer(roomId);
        updateLobby();
    });

    // サーバーサイドタイマー（不正やラグを防ぐ）
    function startGlobalTimer(roomId) {
        const room = rooms.get(roomId);
        if (!room) return;
        if (room.timerInterval) clearInterval(room.timerInterval);

        room.timeLeft = room.settings.timeLimit;
        room.timerInterval = setInterval(() => {
            room.timeLeft--;
            io.to(roomId).emit("tick", { timeLeft: room.timeLeft, turn: room.turn });

            if (room.timeLeft <= 0) {
                clearInterval(room.timerInterval);
                const winner = 1 - room.turn; // 時間切れのプレイヤーの反対が勝利
                io.to(roomId).emit("gameOverSignal", { winner, reason: "TIMEOUT" });
                rooms.delete(roomId);
                updateLobby();
            }
        }, 1000);
    }

    // 石が置かれた時の処理
    socket.on("action_place", (data) => {
        const { roomId, piece, consecutivePairs } = data;
        const room = rooms.get(roomId);

        if (!room || !room.gameStarted) return;
        if (room.players[room.turn] !== socket.id) return;

        // 座標重複チェック
        const isOccupied = room.board.some(p => p.x === piece.x && p.y === piece.y);
        if (isOccupied) return;

        // 状態更新
        room.board.push(piece);
        room.pairCounts = consecutivePairs;
        room.turn = 1 - room.turn;

        // タイマーリセットして次のターンへ
        startGlobalTimer(roomId);

        io.to(roomId).emit("updateState", {
            piece,
            nextTurn: room.turn,
            consecutivePairs: room.pairCounts
        });
    });

    // 勝利宣言
    socket.on("action_win", (data) => {
        const { roomId, winner } = data;
        const room = rooms.get(roomId);
        if (room) {
            if (room.timerInterval) clearInterval(room.timerInterval);
            io.to(roomId).emit("gameOverSignal", { winner, reason: "WIN" });
            rooms.delete(roomId);
            updateLobby();
        }
    });

    socket.on("disconnect", () => {
        for (const [id, room] of rooms) {
            if (room.players.includes(socket.id)) {
                if (room.timerInterval) clearInterval(room.timerInterval);
                io.to(id).emit("opponentLeft");
                rooms.delete(id);
                updateLobby();
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`--- Server Running on Port ${PORT} ---`));


