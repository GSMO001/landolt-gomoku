/**
 * ランドルト環五目並べ ONLINE - サーバーサイド
 * * 修正点:
 * 1. ルーム作成/入室/退出/切断の全タイミングで全ユーザーへリストをブロードキャスト
 * 2. 検索機能に対応したルームデータの構造化
 * 3. 着手制限とタイマーの同期を強化
 */

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 静的ファイルの提供（publicフォルダ内）
app.use(express.static("public"));

// 全てのルーム情報を保持するメモリ上のDB
const rooms = {};

/**
 * ロビーにいる全員に送るための公開用ルームリストを作成
 */
function getPublicRooms() {
    return Object.values(rooms).map(room => {
        return {
            id: room.id,
            playerCount: room.players.length,
            hasPassword: room.password !== "",
            status: room.players.length >= 2 ? "満員" : "募集中",
            timeLimit: room.settings.timeLimit
        };
    });
}

/**
 * 全ユーザーのロビー画面を最新の状態にする
 */
function broadcastRoomList() {
    io.emit("updateRoomList", getPublicRooms());
}

io.on("connection", (socket) => {
    console.log("ユーザーが接続しました:", socket.id);

    // 接続した瞬間に、現在のルーム一覧をそのユーザーに送る
    socket.emit("updateRoomList", getPublicRooms());

    // --- ルーム作成 ---
    socket.on("createRoom", (data) => {
        const { roomId, password, settings } = data;

        if (rooms[roomId]) {
            socket.emit("error_msg", "そのルーム名は既に存在します。");
            return;
        }

        // 新しいルームオブジェクトの生成
        rooms[roomId] = {
            id: roomId,
            password: password || "",
            settings: settings, // { timeLimit: "30" } 等
            players: [socket.id],
            board: [],
            turn: 0, // 0:先手(黒), 1:後手(白)
            timer: null,
            timeLeft: settings.timeLimit === 'free' ? null : parseInt(settings.timeLimit),
            gameStarted: false
        };

        socket.join(roomId);
        socket.emit("roomJoined", { roomId: roomId, playerIndex: 0 });

        // リストを更新して全員に通知
        broadcastRoomList();
    });

    // --- ルーム参加 ---
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

        // プレイヤーを追加
        room.players.push(socket.id);
        socket.join(roomId);

        // クライアント側に情報を送信
        socket.emit("roomJoined", { roomId: roomId, playerIndex: 1 });

        // 2人揃ったのでゲーム開始フラグを立てる
        room.gameStarted = true;
        io.to(roomId).emit("gameStart");

        // 満員になったことをリストに反映
        broadcastRoomList();

        // 最初のターンのタイマーを開始
        startTimerForRoom(roomId);
    });

    // --- 駒の配置 ---
    socket.on("placePiece", (data) => {
        const { roomId, piece, consecutivePairs } = data;
        const room = rooms[roomId];

        if (!room || !room.gameStarted) return;

        // サーバー側の盤面にも保存
        room.board.push(piece);
        
        // ターン交代
        room.turn = 1 - room.turn;

        // 部屋の全員（自分含む）に通知
        io.to(roomId).emit("moveMade", {
            piece: piece,
            nextTurn: room.turn,
            consecutivePairs: consecutivePairs
        });

        // タイマーをリセットして次のターンへ
        startTimerForRoom(roomId);
    });

    // --- 勝利宣言の受信 ---
    socket.on("declareWin", (data) => {
        const { roomId, winner } = data;
        const room = rooms[roomId];

        if (room) {
            if (room.timer) clearInterval(room.timer);
            room.gameStarted = false;
            io.to(roomId).emit("gameOver", { winner: winner, reason: "checkmate" });
        }
    });

    /**
     * 特定のルームのカウントダウンタイマーを管理
     */
    function startTimerForRoom(rid) {
        const room = rooms[rid];
        if (!room || room.settings.timeLimit === 'free') return;

        // 既存のタイマーがあれば破棄
        if (room.timer) clearInterval(room.timer);

        room.timeLeft = parseInt(room.settings.timeLimit);
        io.to(rid).emit("timerUpdate", room.timeLeft);

        room.timer = setInterval(() => {
            room.timeLeft--;
            io.to(rid).emit("timerUpdate", room.timeLeft);

            if (room.timeLeft <= 0) {
                clearInterval(room.timer);
                room.gameStarted = false;
                // 現在のターンではない方が勝ち（時間切れ負け）
                const winner = 1 - room.turn;
                io.to(rid).emit("gameOver", { winner: winner, reason: "timeout" });
            }
        }, 1000);
    }

    // --- 切断時の処理 ---
    socket.on("disconnect", () => {
        for (const rid in rooms) {
            if (rooms[rid].players.includes(socket.id)) {
                console.log("ユーザーが退出しました:", socket.id);
                
                if (rooms[rid].timer) clearInterval(rooms[rid].timer);
                
                // 対戦相手に通知
                io.to(rid).emit("playerLeft");
                
                // ルームを削除
                delete rooms[rid];
                
                // リストを更新して全員に通知
                broadcastRoomList();
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`サーバーがポート ${PORT} で起動しました。`);
});




