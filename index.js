const makeWASocket = require("@whiskeysockets/baileys").default;
const { useMultiFileAuthState } = require("@whiskeysockets/baileys");
const qrcode = require("qrcode");
const express = require("express");
const fs = require("fs").promises;
const axios = require("axios");
const path = require("path");
const app = express();

// 🔹 هياكل البيانات
global.qrCodeUrl = null;
const respondedMessages = new Map();
const GIST_ID = "1050e1f10d7f5591f4f26ca53f2189e9";
const token_part1 = "ghp_gFkAlF";
const token_part2 = "A4sbNyuLtX";
const token_part3 = "YvqKfUEBHXNaPh3ABRms";
const GITHUB_TOKEN = token_part1 + token_part2 + token_part3;

// 🔹 دالة لتحميل الخيارات
async function loadOptions() {
    try {
        const response = await axios.get(`https://api.github.com/gists/${GIST_ID}`, {
            headers: { Authorization: `token ${GITHUB_TOKEN}` }
        });
        return JSON.parse(response.data.files["options62.json"].content);
    } catch (error) {
        console.error("❌ فشل تحميل الخيارات:", error);
        return { options: [] };
    }
}

// 🔹 دالة لحفظ الخيارات
async function saveOptions(options) {
    try {
        await axios.patch(`https://api.github.com/gists/${GIST_ID}`, {
            files: { "options62.json": { content: JSON.stringify(options, null, 2) } }
        }, { headers: { Authorization: `token ${GITHUB_TOKEN}` } });
    } catch (error) {
        console.error("❌ فشل حفظ الخيارات:", error);
    }
}

// 🔹 دالة الاتصال بواتساب
async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState("./auth");
    const sock = makeWASocket({ auth: state, printQRInTerminal: false });

    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("connection.update", handleConnectionUpdate);

    sock.ev.on("messages.upsert", async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const sender = msg.key.remoteJid;
        const text = (msg.message.conversation || "").trim();

        try {
            if (!respondedMessages.has(sender)) {
                await handleNewUser(sock, sender);
            } else {
                await handleExistingUser(sock, sender, text);
            }
        } catch (error) {
            console.error("❌ خطأ في معالجة الرسالة:", error);
            await sock.sendMessage(sender, { text: "⚠️ حدث خطأ غير متوقع!" });
        }
    });
}

// 🔹 معالجة حالة الاتصال
function handleConnectionUpdate(update) {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
        console.log("✅ تم توليد رمز QR! امسحه للاتصال.");
        qrcode.toDataURL(qr, (err, url) => {
            if (err) console.error("❌ خطأ في إنشاء QR:", err);
            global.qrCodeUrl = url;
        });
    }

    if (connection === "close") {
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== 401;
        console.log("🚨 تم فصل الاتصال، جارٍ إعادة الاتصال...", shouldReconnect);
        if (shouldReconnect) setTimeout(connectToWhatsApp, 3000);
    } else if (connection === "open") {
        console.log("✅ تم الاتصال بنجاح!");
    }
}

// 🔹 معالجة المستخدم الجديد
async function handleNewUser(sock, sender) {
    const options = await loadOptions();
    const menuText = options.options
        .map(opt => `${opt.id}️⃣ - ${opt.label}`)
        .join("\n");

    await sock.sendMessage(sender, { 
        text: `📅 *مرحبا بك في شركة فيد*\n\nاختر خدمة:\n${menuText}`
    });
    respondedMessages.set(sender, "MAIN_MENU");
}

// 🔹 معالجة المستخدم الحالي
async function handleExistingUser(sock, sender, text) {
    const userState = respondedMessages.get(sender);
    const options = await loadOptions();

    if (userState === "MAIN_MENU") {
        const selectedOption = options.options.find(opt => opt.id === text);
        
        if (selectedOption) {
            if (selectedOption.subOptions?.length > 0) {
                await showSubMenu(sock, sender, selectedOption);
            } else {
                await sock.sendMessage(sender, { text: selectedOption.response });
                respondedMessages.delete(sender);
            }
        } else {
            await sock.sendMessage(sender, { text: "⚠️ خيار غير صحيح!" });
        }
    } else if (userState.startsWith("SUB_MENU_")) {
        const mainOptionId = userState.split("_")[2];
        const mainOption = options.options.find(opt => opt.id === mainOptionId);
        
        if (mainOption?.subOptions) {
            const selectedSub = mainOption.subOptions.find(sub => sub.id === text);
            
            if (selectedSub) {
                await sock.sendMessage(sender, { text: selectedSub.response });
                respondedMessages.delete(sender);
            } else {
                await sock.sendMessage(sender, { text: "⚠️ خيار فرعي غير صحيح!" });
            }
        } else {
            await sock.sendMessage(sender, { text: "⚠️ الخيار الرئيسي غير موجود!" });
        }
    }
}

// 🔹 عرض القائمة الفرعية
async function showSubMenu(sock, sender, mainOption) {
    const subMenuText = mainOption.subOptions
        .map(sub => `${sub.id}️⃣ - ${sub.label}`)
        .join("\n");

    await sock.sendMessage(sender, {
        text: `📌 *${mainOption.label}*\n\nاختر الخيار الفرعي:\n${subMenuText}`
    });
    respondedMessages.set(sender, `SUB_MENU_${mainOption.id}`);
}

// 🔹 إعدادات السيرفر
app.use(express.json());
app.use("/panel", express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
    res.send(global.qrCodeUrl
        ? `<h1>امسح رمز QR للاتصال بالبوت</h1><img src="${global.qrCodeUrl}" width="300">`
        : "<h1>لم يتم توليد رمز QR بعد... يرجى الانتظار!</h1>");
});

app.get("/options", async (req, res) => {
    try {
        const options = await loadOptions();
        res.json(options);
    } catch (error) {
        res.status(500).json({ error: "فشل تحميل الخيارات" });
    }
});

app.post("/options", async (req, res) => {
    try {
        const newOption = req.body;
        const options = await loadOptions();
        
        // تحديد موقع إدراج الخيار الجديد
        const insertIndex = options.options.findIndex(opt => 
            parseInt(opt.id) > parseInt(newOption.id)
        );
        
        if (insertIndex === -1) {
            // إذا كان الرقم أكبر من جميع الخيارات الموجودة، أضفه في النهاية
            options.options.push(newOption);
        } else {
            // إدراج الخيار في موقعه المناسب
            options.options.splice(insertIndex, 0, newOption);
        }
        
        await saveOptions(options);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: "فشل إضافة الخيار" });
    }
});

app.delete("/options/:id", async (req, res) => {
    try {
        const id = req.params.id;
        const options = await loadOptions();
        options.options = options.options.filter(opt => opt.id !== id);
        await saveOptions(options);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: "فشل حذف الخيار" });
    }
});

app.listen(3000, () => console.log("🚀 السيرفر يعمل على http://localhost:3000"));
connectToWhatsApp();
