/**
 * LANDOLT ONLINE - HIGH-PERFORMANCE SERVER
 * 強化ポイント: 不正防止バリデーション, 自動メモリ管理, 接続安定化
 */

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" },
    pingInterval: 10000, // 接続維持の確認間隔
    pingTimeout: 5000    // 応答なしと判断する時間
});

app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map();

/**
 * 全クライアントに最新のルームリストをブロードキャスト
 */
function broadcastRoomUpdate() {
    const roomList = Array.from(rooms.values()).map(r => ({
        id: r.id,
        playerCount: r.players.length,
        hasPw: r.password !== "",
        status: r.gameStarted ? "PLAYING" : (r.players.length >= 2 ? "FULL" : "OPEN"),
        limit: r.settings.timeLimit
    }));
    io.emit("updateRoomList", roomList);
}

io.on("connection", (socket) => {
    // 接続時に現在の全リストを送付
    socket.emit("updateRoomList", Array.from(rooms.values()).map(r => ({
        id: r.id, playerCount: r.players.length, hasPw: r.password !== "",
        status: r.gameStarted ? "PLAYING" : "OPEN", limit: r.settings.timeLimit
    })));

    // ルーム作成
    socket.on("createRoom", (data) => {
        const { roomId, password, settings } = data;
        if (!roomId || rooms.has(roomId)) {
            return socket.emit("error_msg", "ルーム名が不正、または既に使用されています。");
        }

        const room = {
            id: roomId,
            password: password || "",
            settings: settings || { timeLimit: 60 },
            players: [socket.id],
            board: [],
            turn: 0,
            gameStarted: false,
            pairCounts: [0, 0] // [Player0の連続対, Player1の連続対]
        };

        rooms.set(roomId, room);
        socket.join(roomId);
        socket.emit("roomJoined", { roomId, playerIndex: 0 });
        broadcastRoomUpdate();
        console.log(`Room Created: ${roomId}`);
    });

    // ルーム参加
    socket.on("joinRoom", (data) => {
        const { roomId, password } = data;
        const room = rooms.get(roomId);

        if (!room) return socket.emit("error_msg", "ルームが存在しません。");
        if (room.players.length >= 2) return socket.emit("error_msg", "このルームは満員です。");
        if (room.password !== "" && room.password !== password) {
            return socket.emit("error_msg", "パスワードが正しくありません。");
        }

        room.players.push(socket.id);
        socket.join(roomId);
        socket.emit("roomJoined", { roomId, playerIndex: 1 });

        // 2人揃ったらゲーム開始
        room.gameStarted = true;
        io.to(roomId).emit("gameStart");
        broadcastRoomUpdate();
    });

    // 駒の配置 (重要: サーバーサイドバリデーション)
    socket.on("placePiece", (data) => {
        const { roomId, piece, consecutivePairs } = data;
        const room = rooms.get(roomId);

        // 基本的なバリデーション
        if (!room || !room.gameStarted) return;
        if (room.players[room.turn] !== socket.id) return; // 順番じゃない人の着手を拒否
        
        // 既に駒がある場所への着手を防止
        const isOccupied = room.board.some(p => p.x === piece.x && p.y === piece.y);
        if (isOccupied) return;

        // 盤面更新
        room.board.push(piece);
        room.pairCounts = consecutivePairs;
        room.turn = 1 - room.turn; // ターン交代

        // 全員に同期
        io.to(roomId).emit("moveMade", {
            piece,
            nextTurn: room.turn,
            consecutivePairs: room.pairCounts
        });
    });

    // 勝利宣言の受理
    socket.on("declareWin", (data) => {
        const room = rooms.get(data.roomId);
        if (room && room.gameStarted) {
            room.gameStarted = false;
            io.to(data.roomId).emit("gameOver", { winner: data.winner });
            // ゲーム終了後、少し時間を置いてリストから削除（あるいは即座にOPENに戻す）
            rooms.delete(data.roomId);
            broadcastRoomUpdate();
        }
    });

    // 切断時の処理
    socket.on("disconnect", () => {
        for (const [id, room] of rooms) {
            if (room.players.includes(socket.id)) {
                console.log(`User left room: ${id}`);
                io.to(id).emit("playerLeft");
                rooms.delete(id); // 片方が抜けたらルーム解散（安全策）
                broadcastRoomUpdate();
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`-----------------------------------`);
    console.log(`LANDOLT ONLINE SERVER RUNNING ON ${PORT}`);
    console.log(`-----------------------------------`);
});









