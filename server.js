/**
 * LANDOLT GOMOKU ONLINE - SERVER SIDE
 * すべてのルーム管理、着手バリデーション、接続維持ロジックを統合
 */
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" },
    pingInterval: 10000,
    pingTimeout: 5000
});

app.use(express.static(path.join(__dirname, "public")));

// ルーム情報を保持するMap
const rooms = new Map();

/**
 * 現在存在するルームのリストを整形して全ユーザーに送信
 */
function broadcastRoomList() {
    const roomData = Array.from(rooms.values()).map(r => ({
        id: r.id,
        playerCount: r.players.length,
        hasPw: r.password !== "",
        status: r.gameStarted ? "PLAYING" : (r.players.length >= 2 ? "FULL" : "OPEN"),
        timeLimit: r.settings.timeLimit
    }));
    io.emit("updateRoomList", roomData);
}

io.on("connection", (socket) => {
    console.log(`User Connected: ${socket.id}`);

    // 初回接続時に現在のルームリストを送る
    socket.emit("updateRoomList", Array.from(rooms.values()).map(r => ({
        id: r.id, playerCount: r.players.length, hasPw: r.password !== "",
        status: r.gameStarted ? "PLAYING" : "OPEN", timeLimit: r.settings.timeLimit
    })));

    // ルーム作成処理
    socket.on("createRoom", (data) => {
        const { roomId, password, settings } = data;
        if (!roomId || rooms.has(roomId)) {
            return socket.emit("error_msg", "そのルーム名は使用できないか、既に存在します。");
        }

        const room = {
            id: roomId,
            password: password || "",
            settings: settings || { timeLimit: 60 },
            players: [socket.id],
            board: [],
            turn: 0,
            gameStarted: false,
            pairCounts: [0, 0] // 各プレイヤーの連続「対」カウント
        };

        rooms.set(roomId, room);
        socket.join(roomId);
        socket.emit("roomJoined", { roomId, playerIndex: 0 });
        broadcastRoomList();
    });

    // ルーム参加処理
    socket.on("joinRoom", (data) => {
        const { roomId, password } = data;
        const room = rooms.get(roomId);

        if (!room) return socket.emit("error_msg", "ルームが見つかりません。");
        if (room.players.length >= 2) return socket.emit("error_msg", "満員です。");
        if (room.password !== "" && room.password !== password) {
            return socket.emit("error_msg", "パスワードが一致しません。");
        }

        room.players.push(socket.id);
        socket.join(roomId);
        socket.emit("roomJoined", { roomId, playerIndex: 1 });

        // 2名揃ったのでゲーム開始
        room.gameStarted = true;
        io.to(roomId).emit("gameStart");
        broadcastRoomList();
    });

    // 駒の配置処理（サーバーサイドでのターン・座標バリデーション付）
    socket.on("placePiece", (data) => {
        const { roomId, piece, consecutivePairs } = data;
        const room = rooms.get(roomId);

        if (!room || !room.gameStarted) return;
        if (room.players[room.turn] !== socket.id) return; // ターン外の着手を拒否

        // 既に石がある座標でないかチェック
        const exists = room.board.some(p => p.x === piece.x && p.y === piece.y);
        if (exists) return;

        // 状態を更新
        room.board.push(piece);
        room.pairCounts = consecutivePairs;
        room.turn = 1 - room.turn;

        // 全員に通知
        io.to(roomId).emit("moveMade", {
            piece,
            nextTurn: room.turn,
            consecutivePairs: room.pairCounts
        });
    });

    // 勝利宣言の受付
    socket.on("declareWin", (data) => {
        const { roomId, winner } = data;
        const room = rooms.get(roomId);
        if (room && room.gameStarted) {
            room.gameStarted = false;
            io.to(roomId).emit("gameOver", { winner });
            rooms.delete(roomId); // 終了後ルームを削除
            broadcastRoomList();
        }
    });

    // 切断処理
    socket.on("disconnect", () => {
        for (const [id, room] of rooms) {
            if (room.players.includes(socket.id)) {
                io.to(id).emit("playerLeft");
                rooms.delete(id);
                broadcastRoomList();
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server is running on port ${PORT}`));










