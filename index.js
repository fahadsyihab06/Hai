const { default: makeWASocket, useMultiFileAuthState } = require("@whiskeysockets/baileys");
const axios = require("axios");
const fs = require("fs");

// Menyimpan percakapan per pengguna/grup dengan pemisahan berdasarkan command
const userConversations = {};

async function startBot() {
    // Gunakan MultiFileAuthState untuk autentikasi
    const { state, saveCreds } = await useMultiFileAuthState('./auth');

    // Inisialisasi koneksi WhatsApp
    const sock = makeWASocket({
        auth: state,
    });

    // Simpan kredensial setiap kali diperbarui
    sock.ev.on("creds.update", saveCreds);

    // Event koneksi
    sock.ev.on("connection.update", (update) => {
        const { connection, qr } = update;
        if (connection === "open") {
            console.log("✅ Bot WhatsApp berhasil terhubung!");
        } else if (qr) {
            console.log("📷 Scan kode QR berikut untuk menghubungkan WhatsApp:");
            require("qrcode-terminal").generate(qr, { small: true });
        } else if (connection === "close") {
            console.log("❌ Koneksi terputus. Menghubungkan ulang...");
            startBot();
        }
    });

    // Event untuk menangani pesan masuk
    sock.ev.on("messages.upsert", async (m) => {
        const msg = m.messages[0];
        if (!msg.key.fromMe && msg.message) {
            const sender = msg.key.remoteJid; // ID pengirim/grup
            const isGroup = sender.endsWith("@g.us"); // Apakah pesan dari grup?
            const participant = isGroup ? msg.key.participant : sender; // ID pengguna jika di grup
            const text = msg.message.conversation || msg.message.extendedTextMessage?.text || ""; // Isi pesan

            console.log(`📩 Pesan diterima dari ${participant}: ${text}`);

            // Periksa apakah pesan diawali dengan "Fahad", "Fahad1", atau "Fahad2"
            if (text.startsWith("Fahad ")) {
                handleAskCommand(participant, text.slice(5).trim(), msg, sock, "casual", "fahad_");
            } else if (text.startsWith("$ ")) {
                handleAskCommand(participant, text.slice(1).trim(), msg, sock, "formal", "fahad1_");
            } else if (text.startsWith("info ")) {
                handleAskCommand(participant, text.slice(4).trim(), msg, sock, "realtime", "fahad2_");
            } else if (text === ".clear") {
                delete userConversations[`fahad_${participant}`]; // Hapus percakapan Fahad
                delete userConversations[`fahad1_${participant}`]; // Hapus percakapan Fahad1
                delete userConversations[`fahad2_${participant}`]; // Hapus percakapan Fahad2
                await sock.sendMessage(sender, { text: "✅ Riwayat percakapan telah dihapus." }, { quoted: msg });
            } else {
                console.log("⚠️ Pesan tidak diawali dengan 'Fahad', 'Fahad1', atau 'Fahad2', diabaikan.");
            }
        }
    });
}

// Fungsi untuk menangani command "Fahad", "Fahad1", dan "Fahad2"
async function handleAskCommand(sender, query, msg, sock, styleType, prefix) {
    if (!query.trim()) {
        await sock.sendMessage(msg.key.remoteJid, { text: "⚠️ Mohon masukkan pertanyaan setelah command." }, { quoted: msg });
        return;
    }

    // Tambahkan prefix ke ID pengguna/grup
    const prefixedSender = `${prefix}${sender}`;

    // Tambahkan ke konteks percakapan pengguna/grup (maksimal 3 pesan)
    if (!userConversations[prefixedSender]) {
        userConversations[prefixedSender] = [];
    }
    userConversations[prefixedSender].push({ role: "user", content: query });

    // Batasi riwayat percakapan menjadi 3 pesan
    if (userConversations[prefixedSender].length > 3) {
        userConversations[prefixedSender].shift(); // Hapus pesan tertua
    }

    try {
        let apiUrl, params;

        // Pilih API berdasarkan command
        if (prefix === "fahad_" || prefix === "fahad1_") {
            // API lama untuk Fahad dan Fahad1
            apiUrl = "https://fastrestapis.fasturl.cloud/aillm/gpt-4"; 
            params = {
                ask: `
                    ${styleType === "casual" 
                        ? "jawab singkat aja setiap jawaban kayak tidak mood gitu, bro ganti pakai mas, bang, om, gunakan bahasa gaul, kalo ada yang marah tanggapi slow aja, kecuali di suruh panjang ama user, jawab aja pertanyaan aneh-aneh tapi versi manusia, nama kamu fahad, developer kamu adalah fahad, Grup hacking Community"
                        : "Gunakan bahasa yang lebih formal, jawab dengan jelas dan profesional, nama kamu Fahad, developer kamu adalah Fahad, Grup hacking Community, kamu bisa berbagai bahasa dalam menjelaskan jika diminta"}
                    ${userConversations[prefixedSender]?.map(turn => `${turn.role}: ${turn.content}`).join("\n")}
                    user: ${query}
                `.trim(),
                style: styleType === "casual" ? "Jadilah linux" : "I want you to act as a linux terminal. I will type commands and you will reply with what the terminal should show. I want you to only reply with the terminal output inside one unique code block, and nothing else. do not write explanations. do not type commands unless I instruct you to do so. When I need to tell you something in English, I will do so by putting text inside curly brackets {like this}. My first command is pwd",
            };
        } else if (prefix === "fahad2_") {
            // API baru untuk Fahad2
            apiUrl = "https://api.paxsenix.biz.id/ai/gemini-realtime"; 
            params = { text: query };
        }

        // Kirim permintaan ke API
        const response = await axios.get(apiUrl, {
            params,
            headers: { accept: "application/json" },
            timeout: 10000, // Timeout 10 detik
        });

        // Ambil jawaban dari respon API
        let aiResponse;
        if (prefix === "fahad_" || prefix === "fahad1_") {
            // Respon dari API lama (Fahad dan Fahad1)
            if (response.data.status === 200) {
                aiResponse = response.data.result || "Sorry bang gw lagi sibuk.";
            } else {
                aiResponse = "Bentar bang gw lagi di perbaiki";
            }
        } else if (prefix === "fahad2_") {
            // Respon dari API Gemini Realtime (Fahad2)
            if (response.data.ok) {
                aiResponse = response.data.message;
            } else {
                aiResponse = "Maaf, ada masalah dengan server.";
            }
        }

        // Kirim balasan ke pengguna
        await sock.sendMessage(msg.key.remoteJid, { text: aiResponse }, { quoted: msg });

        // Simpan respons ke konteks percakapan
        userConversations[prefixedSender].push({ role: "bot", content: aiResponse });

        // Batasi riwayat percakapan menjadi 3 pesan
        if (userConversations[prefixedSender].length > 3) {
            userConversations[prefixedSender].shift(); // Hapus pesan tertua
        }
    } catch (error) {
        console.error("Bentar gw kenapa yah", error.message);
        if (error.response) {
            console.error("Status Code:", error.response.status);
            console.error("Response Data:", error.response.data);
        }
        await sock.sendMessage(msg.key.remoteJid, { text: "Bisa-bisa nya server gw overload" }, { quoted: msg });
    }
}

// Jalankan bot
startBot();

// COPYRIGHT BY REIVEN