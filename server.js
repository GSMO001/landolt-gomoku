/**
 * ランドルト環五目並べ ONLINE - サーバーサイド・フルスペック
 */
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    pingTimeout: 30000,
    pingInterval: 10000
});

app.use(express.static(path.join(__dirname, "public")));

// ゲームデータ管理
const rooms = new Map();

/**
 * 公開ルーム情報の生成
 */
function getRoomListData() {
    const list = [];
    for (const [id, r] of rooms) {
        list.push({
            id: id,
            playerCount: r.players.length,
            hasPassword: r.password !== "",
            status: r.players.length >= 2 ? "満員" : "募集中",
            timeLimit: r.settings.timeLimit
        });
    }
    return list;
}

function broadcastRoomList() {
    io.emit("updateRoomList", getRoomListData());
}

io.on("connection", (socket) => {
    console.log(`User connected: ${socket.id}`);
    
    // 初回リスト送信
    socket.emit("updateRoomList", getRoomListData());

    // ルーム作成
    socket.on("createRoom", (data) => {
        const { roomId, password, settings } = data;
        if (!roomId) return socket.emit("error_msg", "ルーム名を入力してください。");
        if (rooms.has(roomId)) return socket.emit("error_msg", "そのルーム名は既に使用されています。");

        const roomObj = {
            id: roomId,
            password: password || "",
            settings: settings,
            players: [socket.id],
            board: [],
            turn: 0, // 0: 黒, 1: 白
            timer: null,
            timeLeft: settings.timeLimit === 'free' ? null : parseInt(settings.timeLimit),
            gameStarted: false,
            pairCounts: [0, 0]
        };

        rooms.set(roomId, roomObj);
        socket.join(roomId);
        socket.emit("roomJoined", { roomId, playerIndex: 0 });
        broadcastRoomList();
    });

    // 入室処理
    socket.on("joinRoom", (data) => {
        const { roomId, password } = data;
        const room = rooms.get(roomId);

        if (!room) return socket.emit("error_msg", "ルームが見つかりません。");
        if (room.players.length >= 2) return socket.emit("error_msg", "満員のため入室できません。");
        if (room.password !== "" && room.password !== password) {
            return socket.emit("error_msg", "パスワードが正しくありません。");
        }

        room.players.push(socket.id);
        socket.join(roomId);
        socket.emit("roomJoined", { roomId, playerIndex: 1 });

        // ゲーム開始
        room.gameStarted = true;
        io.to(roomId).emit("gameStart");
        broadcastRoomList();
        
        // 最初のタイマー始動
        startTimer(roomId);
    });

    // 駒打ちの同期
    socket.on("placePiece", (data) => {
        const { roomId, piece, consecutivePairs } = data;
        const room = rooms.get(roomId);
        if (!room || !room.gameStarted) return;

        // 手番チェック
        const currentPlayerId = room.players[room.turn];
        if (socket.id !== currentPlayerId) return;

        // 盤面更新
        room.board.push(piece);
        room.pairCounts = consecutivePairs;
        room.turn = 1 - room.turn; // ターン交代

        // 全員に通知
        io.to(roomId).emit("moveMade", {
            piece,
            nextTurn: room.turn,
            consecutivePairs: room.pairCounts
        });

        // タイマー再設定
        startTimer(roomId);
    });

    // 勝利宣言の受理
    socket.on("declareWin", (data) => {
        const { roomId, winner, reason } = data;
        const room = rooms.get(roomId);
        if (room) {
            stopTimer(room);
            room.gameStarted = false;
            io.to(roomId).emit("gameOver", { winner, reason: reason || "checkmate" });
        }
    });

    function stopTimer(room) {
        if (room.timer) {
            clearInterval(room.timer);
            room.timer = null;
        }
    }

    function startTimer(rid) {
        const room = rooms.get(rid);
        if (!room || room.settings.timeLimit === 'free') return;
        
        stopTimer(room);
        room.timeLeft = parseInt(room.settings.timeLimit);
        io.to(rid).emit("timerUpdate", room.timeLeft);

        room.timer = setInterval(() => {
            room.timeLeft--;
            io.to(rid).emit("timerUpdate", room.timeLeft);

            if (room.timeLeft <= 0) {
                stopTimer(room);
                room.gameStarted = false;
                // 時間切れ負け（現在のターンのプレイヤーが負け）
                io.to(rid).emit("gameOver", { winner: 1 - room.turn, reason: "timeout" });
            }
        }, 1000);
    }

    // 切断処理
    socket.on("disconnect", () => {
        for (const [rid, room] of rooms) {
            if (room.players.includes(socket.id)) {
                stopTimer(room);
                io.to(rid).emit("playerLeft");
                rooms.delete(rid);
                broadcastRoomList();
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`LANDOLT ONLINE SERVER RUNNING ON PORT ${PORT}`);
});
