const TelegramBot = require('node-telegram-bot-api');
const mongoose = require("mongoose");

const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

bot.on('polling_error', (error) => {
  console.log('Polling Error:', error.code || error.message);
});

const ADMIN_ID = 7577278314;

const addresses = {
  BEP20: "0xbFdc15A24Ca5A8c256737d4841201B4a73eF30c6",
  TRC20: "TJLELs9JXQzjCak6orooEEnVPKdnQB2eee",
  TON: "UQBtaBtVyi-FezxMyeY6udXUQDPyBbFbcmxilYKinPKim2md"
};

// ===== MONGODB SETUP =====
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => console.log("❌ MongoDB Error:", err));

// ===== SCHEMAS =====
const userSchema = new mongoose.Schema({
  chatId: { type: String, unique: true },
  username: String,
  name: String,
  step: String,
  productType: String, // "BEP20" or "TRC20"
  payMethod: String,   // "BEP20", "TRC20", "TON"
  orderId: Number,
  isDemo: Boolean,
  isBlocked: { type: Boolean, default: false },
  bep20DemoUsed: { type: Boolean, default: false },
  trc20DemoUsed: { type: Boolean, default: false },
  hasRealOrder: { type: Boolean, default: false },
  totalSpent: { type: Number, default: 0 },
  demoCompletedAt: Date,
  registeredAt: { type: Date, default: Date.now },
  lastFollowupSent: { type: String, default: null },
  replyTo: String,
  tempEditOrderId: Number
});

const orderSchema = new mongoose.Schema({
  orderId: { type: Number, unique: true },
  chatId: String,
  amount: Number,
  productType: String,
  payMethod: String,
  isDemo: Boolean,
  status: { type: String, default: "PENDING" }, // "PENDING", "APPROVED", "REJECTED"
  details: String,
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model("User", userSchema);
const Order = mongoose.model("Order", orderSchema);

// ===== ABUSE & HOSTILITY FILTER PATTERNS =====
const VULGAR_PATTERNS = [
  // English profanity & slurs
  /\b(fuck|fucking|fucker|motherfucker|bitch|bastard|asshole|dick|cunt|slut)\b/i,
  /\b(fuck\s+your\s+(mom|mother|sister|family))\b/i,
  // Hindi/Hinglish Romanized abuse
  /\b(madarchod|mc|bhenchod|bc|behenchod|chutiya|choot|bhosdike|bhosadi|bhosada)\b/i,
  /\b(gaand|gand|gandu|lauda|loda|lodu|chinal|randi|harami|kamine|suar|kutta)\b/i,
  /\b(teri\s+maa|teri\s+behen|maa\s+ki|chudwa|chudao)\b/i,
  // Hindi (Devanagari script)
  /(मादरचोद|बहनचोद|भोसड़ीके|चूतिया|गांडू|लौड़ा|रांड|कमीने|हरामी)/i
];

const ACCUSATION_PATTERNS = [
  // Targeted accusations (allows inquiries like "how do I know it's not scam?")
  /\b(u|you|ur|you're|youre|tu|tum)\s+(are\s+)?(a\s+)?(scammer|chor|thief|fraudster|cheat|cheater)\b/i,
  /\b(tu\s+chor\s+hai|scam\s+karta\s+hai|paisa\s+loot\s+raha)\b/i,
  /\b(scam\s*bot|fake\s*bot)\b/i,
  // Explicit threats
  /\b(police|cyber\s*crime|fir)\s+(karunga|kar\s+raha|report\s+karunga)\b/i,
  /\b(i\s+will\s+report\s+u|i\s+will\s+ban\s+you|will\s+sue\s+you)\b/i
];

function isAbusiveOrHostile(str) {
  if (!str) return false;
  for (const regex of VULGAR_PATTERNS) {
    if (regex.test(str)) return true;
  }
  for (const regex of ACCUSATION_PATTERNS) {
    if (regex.test(str)) return true;
  }
  return false;
}

// ===== HELPERS =====
async function getUser(chatId, username = "NoUsername", name = "User") {
  const user = await User.findOneAndUpdate(
    { chatId: String(chatId) },
    { $setOnInsert: { username, name, registeredAt: new Date() } },
    { new: true, upsert: true }
  );
  return user;
}

function getBalance(amount, productType = "BEP20", isDemo = false) {
  if (isDemo) {
    if (productType === "TRC20") return "$300 Flash Balance (TRC20 Demo)";
    return "$20 Flash Balance (BEP20 Demo)";
  }

  if (productType === "TRC20") {
    if (amount >= 320) return "$5,000 Flash Balance";
    if (amount >= 200) return "$3,200 Flash Balance";
    if (amount >= 100) return "$1,000 Flash Balance";
    return `$${amount * 10} Flash Balance`;
  } else {
    if (amount >= 100) return "$6,500 Flash Balance";
    if (amount >= 50) return "$3,200 Flash Balance";
    if (amount >= 30) return "$1,600 Flash Balance";
    if (amount >= 20) return "$1,000 Flash Balance";
    return `$${amount * 50} Flash Balance`;
  }
}

// ---------------- START MENU ----------------
async function showMainMenu(chatId) {
  const user = await getUser(chatId);
  user.step = null;
  await user.save();

  bot.sendMessage(chatId,
`💎 *Welcome to USDTExpress* 💎

⚡ The #1 Automated Flash USDT Provider
🔒 Instant On-Chain Processing
🎰 Fully compatible with gaming & utility platforms

🔥 *Today's Network Status:* 100% Online & Fast
📦 *Minimum Pack:* $20

👇 *Select an option below to get started:*`,
        {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "💰 Buy Flash USDT Packs", callback_data: "buy_menu" }],
          [{ text: "📊 Complete Price List", callback_data: "price" }],
          [{ text: "🎁 Test Demo & Support", callback_data: "support" }]
        ]
      }
    }
  );
}

bot.onText(/\/start/, async (msg) => {
  await showMainMenu(msg.chat.id);
});

// ---------------- ADMIN PANEL ----------------
async function showAdminPanel(chatId) {
  if (chatId != ADMIN_ID) return;

  const now = new Date();
  const startOfDay = new Date(now.setHours(0, 0, 0, 0));
  const startOfWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const startOfMonth = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const totalUsers = await User.countDocuments();
  const demoUsers = await User.countDocuments({ $or: [{ bep20DemoUsed: true }, { trc20DemoUsed: true }] });
  const realOrdersCount = await Order.countDocuments({ status: "APPROVED", isDemo: false });

  const allApproved = await Order.find({ status: "APPROVED" });
  const todayApproved = allApproved.filter(o => o.createdAt >= startOfDay);
  const weekApproved = allApproved.filter(o => o.createdAt >= startOfWeek);
  const monthApproved = allApproved.filter(o => o.createdAt >= startOfMonth);

  const revToday = todayApproved.reduce((sum, o) => sum + (o.amount || 0), 0);
  const revWeek = weekApproved.reduce((sum, o) => sum + (o.amount || 0), 0);
  const revMonth = monthApproved.reduce((sum, o) => sum + (o.amount || 0), 0);
  const revTotal = allApproved.reduce((sum, o) => sum + (o.amount || 0), 0);

  bot.sendMessage(chatId,
`👑 *Executive Admin Control Dashboard*

📈 *Verified Real Revenue:*
├ 💵 Today: \`$${revToday} USDT\`
├ 📅 7 Days: \`$${revWeek} USDT\`
├ 🗓️ 30 Days: \`$${revMonth} USDT\`
└ 💰 All-Time: \`$${revTotal} USDT\`

📊 *Business Overview:*
├ 👥 Total Users: \`${totalUsers}\`
├ 🎁 Demos Delivered: \`${demoUsers}\`
└ 📦 Real Orders Approved: \`${realOrdersCount}\`

⚙️ *Management Operations:*`,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "🔄 Reset User Demo", callback_data: "admin_reset_demo" }],
          [{ text: "📢 Broadcast Menu", callback_data: "admin_broadcast_menu" }],
          [{ text: "🔙 Exit Admin", callback_data: "back" }]
        ]
      }
    }
  );
}

bot.onText(/\/admin/, async (msg) => {
  await showAdminPanel(msg.chat.id);
});

// ---------------- CALLBACK QUERIES ----------------
bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;
  const username = query.from.username ? `@${query.from.username}` : "NoUsername";
  const name = query.from.first_name || "User";

  const user = await getUser(chatId, username, name);

  // Check if user is blocked when attempting to buy or access support
  if (user.isBlocked && (data === "buy_menu" || data.startsWith("choose_coin_") || data.startsWith("pay_method_") || data === "support" || data === "demo_menu" || data.startsWith("demo_select_") || data === "need_help")) {
    return bot.answerCallbackQuery(query.id, { text: "⚠️ System is currently under maintenance. Please try again later.", show_alert: true });
  }

  if (data === "buy_menu") {
    user.isDemo = false;
    await user.save();

    bot.editMessageText(
`🛍️ *Step 1: Select Flash USDT Network to Receive:*

💎 *BEP-20 Flash USDT* (Min $20 | Maximum 65x Multiplier)
🔺 *TRC-20 Flash USDT* (Min $100 | Ultra Fast Network)`,
      {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "💎 BEP-20 Flash USDT (Min $20)", callback_data: "choose_coin_BEP20" }],
            [{ text: "🔺 TRC-20 Flash USDT (Min $100)", callback_data: "choose_coin_TRC20" }],
            [{ text: "🔙 Back", callback_data: "back" }]
          ]
        }
      }
    );
  } else if (data.startsWith("choose_coin_")) {
    const product = data.split("_")[2];
    user.productType = product;
    await user.save();

    let minAmount = product === "TRC20" ? "$100" : "$20";

    bot.editMessageText(
`💳 *Step 2: Choose Your Payment Method:*
*(Send ${minAmount} or chosen package amount)*`,
      {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "♦️ BEP-20 USDT", callback_data: "pay_method_BEP20" }],
            [{ text: "🔺 TRC-20 USDT", callback_data: "pay_method_TRC20" }],
            [{ text: "🔷 TON USDT", callback_data: "pay_method_TON" }],
            [{ text: "🔙 Back", callback_data: "buy_menu" }]
          ]
        }
      }
    );
  } else if (data === "price") {
    bot.editMessageText(
`💎 *BEP-20 PACKAGES (Pay with any crypto)*
├ 💵 $20 Real USDT  → $1,000 Flash Balance
├ 💵 $30 Real USDT  → $1,600 Flash Balance
├ 💵 $50 Real USDT  → $3,200 Flash Balance 🔥 [MOST POPULAR]
└ 💵 $100 Real USDT → $6,500 Flash Balance 💎 [BEST VALUE - 65x]

🔺 *TRC-20 PACKAGES (Pay with any crypto)*
├ 💵 $100 Real USDT → $1,000 Flash Balance
├ 💵 $200 Real USDT → $3,200 Flash Balance ⚡ [POPULAR]
└ 💵 $320 Real USDT → $5,000 Flash Balance 👑 [MAX VALUE]`,
      {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "💰 Buy Now", callback_data: "buy_menu" }],
            [{ text: "🔙 Back", callback_data: "back" }]
          ]
        }
      }
    );
  } else if (data === "support") {
    bot.editMessageText(
`📩 *Support Center & Verification*

Choose an option below:`,
      {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "🎁 Try Test Demo Pack", callback_data: "demo_menu" }],
            [{ text: "💬 Live Admin Chat", callback_data: "need_help" }],
            [{ text: "📢 Recent Verified order", url: "https://t.me/TROONCHAIN" }],
            [{ text: "🔙 Back", callback_data: "back" }]
          ]
        }
      }
    );
  } else if (data === "demo_menu") {
    bot.editMessageText(
`🎁 *Test Demo Plans (Strictly 1 per user)*

🔹 *BEP-20 Demo:* Pay $2 Real USDT → Get $20 Flash Balance
🔸 *TRC-20 Demo:* Pay $30 Real USDT → Get $300 Flash Balance`,
      {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "♦️ BEP-20 Demo ($2)", callback_data: "demo_select_BEP20" }],
            [{ text: "🔺 TRC-20 Demo ($30)", callback_data: "demo_select_TRC20" }],
            [{ text: "🔙 Back", callback_data: "support" }]
          ]
        }
      }
    );
  } else if (data.startsWith("demo_select_")) {
    const demoCoin = data.split("_")[2];

    if (demoCoin === "BEP20" && user.bep20DemoUsed) {
      return bot.answerCallbackQuery(query.id, { text: "❌ BEP20 Demo already used! Check standard packs.", show_alert: true });
    }
    if (demoCoin === "TRC20" && user.trc20DemoUsed) {
      return bot.answerCallbackQuery(query.id, { text: "❌ TRC20 Demo already used! Check standard packs.", show_alert: true });
    }

    user.isDemo = true;
    user.productType = demoCoin;
    await user.save();

    let cost = demoCoin === "BEP20" ? "$2" : "$30";

    bot.editMessageText(
`🎁 *${demoCoin} Demo Setup (${cost})*

Select your payment network to pay ${cost}:`,
      {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "♦️ BEP-20", callback_data: "pay_method_BEP20" }],
            [{ text: "🔺 TRC-20", callback_data: "pay_method_TRC20" }],
            [{ text: "🔷 TON", callback_data: "pay_method_TON" }],
            [{ text: "🔙 Back", callback_data: "demo_menu" }]
          ]
        }
      }
    );
  } else if (data.startsWith("pay_method_")) {
    const payMethod = data.split("_")[2];
    user.payMethod = payMethod;
    user.step = "one_step_submit";
    await user.save();

    let amountText = "";
    if (user.isDemo) {
      amountText = user.productType === "BEP20" ? "$2" : "$30";
    } else {
      amountText = user.productType === "TRC20" ? "$100 or more" : "$20 or more";
    }

    bot.editMessageText(
`💳 *Payment Details & Transfer Address*

📦 *Item:* \`${user.productType} Flash USDT\` ${user.isDemo ? "*(DEMO)*" : ""}
🌐 *Network:* \`${payMethod}\`
💰 *Amount to Send:* *${amountText}*

Transfer USDT to this official address:
\`${addresses[payMethod]}\`
*(Tap address to copy)*

━━━━━━━━━━━━━━━━━━━━━
👇 *AFTER SENDING, DIRECTLY REPLY WITH:*
1️⃣ Exact amount transferred
2️⃣ Your TXID & Receiving Wallet Address

*Type your message below now:*`,
      {
        parse_mode: "Markdown",
        chat_id: chatId,
        message_id: query.message.message_id,
        reply_markup: {
          inline_keyboard: [
            [{ text: "🔙 Cancel / Back", callback_data: user.isDemo ? "demo_menu" : "buy_menu" }]
          ]
        }
      }
    );
  } else if (data === "need_help") {
    user.step = "support";
    await user.save();
    bot.sendMessage(chatId, "📩 *Live Support Desk:*\n\nType your message below. An admin will reply directly inside this chat:", { parse_mode: "Markdown" });
  } else if (data === "back") {
    await showMainMenu(chatId);
  }

  // ===== ADMIN CALLBACKS =====
  else if (data === "admin_reset_demo") {
    if (chatId != ADMIN_ID) return;
    user.step = "admin_enter_reset_id";
    await user.save();
    bot.sendMessage(ADMIN_ID, "✍️ *Send the Chat ID of the user to unlock demo:*", { parse_mode: "Markdown" });
  } else if (data === "admin_broadcast_menu") {
    if (chatId != ADMIN_ID) return;
    bot.sendMessage(ADMIN_ID,
`📢 *Targeted Broadcast Commands:*

• \`/broadcast_all <msg>\` → Send to everyone
• \`/broadcast_demo <msg>\` → Send to demo users (upsell)
• \`/broadcast_inactive <msg>\` → Send to $0 inactive users`,
      { parse_mode: "Markdown" }
    );
  }

  // ===== APPROVE / REJECT / EDIT HANDLERS =====
  else if (data.startsWith("approve_") || data.startsWith("reject_") || data.startsWith("editamount_") || data.startsWith("reply_")) {
    const orderId = Number(data.split("_")[1]);

    if (data.startsWith("approve_")) {
      const order = await Order.findOne({ orderId });
      if (order && order.status !== "PENDING") return bot.answerCallbackQuery(query.id, { text: "Already finalized" });
      if (!order) return bot.answerCallbackQuery(query.id, { text: "Order not found" });

      order.status = "APPROVED";
      await order.save();

      const targetUser = await User.findOne({ chatId: order.chatId });
      const balance = getBalance(order.amount, order.productType, order.isDemo);

      bot.sendMessage(order.chatId,
`🎉 *Flash USDT Delivered Successfully!*

💰 *Delivered:* ${balance}
⚡ *Network:* ${order.productType} Flash USDT
💵 *Amount Processed:* $${order.amount} USDT

Thank you for your business! Tap /start to order again anytime.`,
        { parse_mode: "Markdown" }
      );

      if (targetUser) {
        if (order.isDemo) {
          if (order.productType === "TRC20") targetUser.trc20DemoUsed = true;
          else targetUser.bep20DemoUsed = true;
          targetUser.demoCompletedAt = new Date();
        } else {
          targetUser.hasRealOrder = true;
          targetUser.totalSpent += order.amount;
        }
        await targetUser.save();
      }

      bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message.message_id });
      bot.sendMessage(ADMIN_ID, `✅ Order \`#${orderId}\` APPROVED ($${order.amount} logged to revenue).`, { parse_mode: "Markdown" });
      bot.answerCallbackQuery(query.id, { text: "Approved" });

    } else if (data.startsWith("editamount_")) {
      user.tempEditOrderId = orderId;
      user.step = "admin_set_new_amount";
      await user.save();
      bot.sendMessage(ADMIN_ID, `✍️ *Order #${orderId}:* Enter the ACTUAL dollar amount received (e.g. 50, 100, 320):`, { parse_mode: "Markdown" });
      bot.answerCallbackQuery(query.id);

    } else if (data.startsWith("reject_")) {
      const order = await Order.findOne({ orderId });
      if (order) {
        order.status = "REJECTED";
        await order.save();
        bot.sendMessage(order.chatId, "❌ *Payment Verification Failed.* Transaction not found on blockchain. Reach out via Support if you believe this is a mistake.", { parse_mode: "Markdown" });
      }
      bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message.message_id });
      bot.sendMessage(ADMIN_ID, `❌ Order \`#${orderId}\` REJECTED ($0 logged).`, { parse_mode: "Markdown" });
      bot.answerCallbackQuery(query.id, { text: "Rejected" });

    } else if (data.startsWith("reply_")) {
      const targetChatId = data.split("_")[1];
      user.replyTo = targetChatId;
      user.step = "admin_reply";
      await user.save();
      bot.sendMessage(ADMIN_ID, `✍️ *Type reply message for user ${targetChatId}:*`, { parse_mode: "Markdown" });
    }
  }
});

// ---------------- MESSAGE HANDLERS ----------------
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (!text || text.startsWith("/")) return;

  const username = msg.from.username ? `@${msg.from.username}` : "NoUsername";
  const name = msg.from.first_name || "User";
  const user = await getUser(chatId, username, name);

  // Admin: Reset user demo
  if (user.step === "admin_enter_reset_id" && chatId == ADMIN_ID) {
    const target = await User.findOne({ chatId: text.trim() });
    if (!target) {
      bot.sendMessage(ADMIN_ID, "❌ User not found.");
    } else {
      target.bep20DemoUsed = false;
      target.trc20DemoUsed = false;
      target.lastFollowupSent = null;
      await target.save();
      bot.sendMessage(ADMIN_ID, `✅ Demo reset for user \`${text.trim()}\`!`);
    }
    user.step = null;
    await user.save();
    return;
  }

  // Admin: Edit amount & approve
  if (user.step === "admin_set_new_amount" && chatId == ADMIN_ID) {
    const newAmount = parseFloat(text.trim());
    if (isNaN(newAmount) || newAmount <= 0) return bot.sendMessage(ADMIN_ID, "❌ Enter a valid number.");

    const orderId = user.tempEditOrderId;
    const order = await Order.findOne({ orderId });
    if (!order) return bot.sendMessage(ADMIN_ID, "❌ Order not found.");

    order.amount = newAmount;
    order.status = "APPROVED";
    await order.save();

    const targetUser = await User.findOne({ chatId: order.chatId });
    const balance = getBalance(newAmount, order.productType, order.isDemo);

    bot.sendMessage(order.chatId,
`🎉 *Flash USDT Delivered Successfully!*

💰 *Delivered:* ${balance}
⚡ *Network:* ${order.productType} Flash USDT
💵 *Amount Processed:* $${newAmount} USDT

Thank you for your business! Tap /start to order again anytime.`,
      { parse_mode: "Markdown" }
    );

    if (targetUser) {
      if (order.isDemo) {
        if (order.productType === "TRC20") targetUser.trc20DemoUsed = true;
        else targetUser.bep20DemoUsed = true;
        targetUser.demoCompletedAt = new Date();
      } else {
        targetUser.hasRealOrder = true;
        targetUser.totalSpent += newAmount;
      }
      await targetUser.save();
    }

    bot.sendMessage(ADMIN_ID, `✅ Order \`#${orderId}\` updated to **$${newAmount}** and APPROVED!`, { parse_mode: "Markdown" });
    user.step = null;
    user.tempEditOrderId = null;
    await user.save();
    return;
  }

  // Admin: Reply to user support
  if (user.step === "admin_reply" && chatId == ADMIN_ID) {
    bot.sendMessage(user.replyTo, `📩 *Support Response:*\n\n${text}`, { parse_mode: "Markdown" });
    bot.sendMessage(ADMIN_ID, "✅ Reply sent.");
    user.step = null;
    await user.save();
    return;
  }

  // Blocked check for text interactions
  if (user.isBlocked && (user.step === "support" || user.step === "one_step_submit")) {
    user.step = null;
    await user.save();
    return bot.sendMessage(chatId, "⚠️ *System is currently under maintenance. Please try again later.*", { parse_mode: "Markdown" });
  }

  // User: Support message
  if (user.step === "support") {
    // Check if user is using abusive language or hostile scam accusations
    if (chatId != ADMIN_ID && isAbusiveOrHostile(text)) {
      user.isBlocked = true;
      user.step = null;
      await user.save();

      bot.sendMessage(chatId, "⚠️ *System is currently under maintenance. Please try again later.*", { parse_mode: "Markdown" });
      bot.sendMessage(ADMIN_ID, `🚫 User \`${chatId}\` was **AUTO-BLOCKED** for vulgarity/accusation.\n💬 Message: "${text}"`, { parse_mode: "Markdown" });
      return;
    }

    bot.sendMessage(ADMIN_ID,
`📩 *Support Ticket*
👤 *From:* \`${chatId}\` (${name} ${username})
💬 *Message:* ${text}`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [[{ text: "✍️ Reply", callback_data: `reply_${chatId}` }]]
        }
      }
    );
    bot.sendMessage(chatId, "✅ Support request received. An admin will respond here shortly.");
    user.step = null;
    await user.save();
    return;
  }
   // User: 1-Step checkout submission
  if (user.step === "one_step_submit") {
    const matchAmount = text.match(/\d+(\.\d+)?/);
    let extractedAmount = matchAmount ? parseFloat(matchAmount[0]) : (user.isDemo ? (user.productType === "BEP20" ? 2 : 30) : 20);

    const orderId = Date.now() + Math.floor(Math.random() * 1000);
    user.step = null;
    await user.save();

    await Order.create({
      orderId,
      chatId: String(chatId),
      amount: extractedAmount,
      productType: user.productType || "BEP20",
      payMethod: user.payMethod || "BEP20",
      isDemo: Boolean(user.isDemo),
      status: "PENDING",
      details: text
    });

    bot.sendMessage(chatId,
`⏳ *Transaction Received & In Queue*

🆔 *Order ID:* \`#${orderId}\`
Your payment is verifying on the blockchain. You will receive an instant notification once your Flash USDT balance arrives!`,
      { parse_mode: "Markdown" }
    );

    bot.sendMessage(ADMIN_ID,
`🚨 *NEW ORDER ALERT*
🆔 *Order:* \`#${orderId}\`
👤 *User:* \`${chatId}\` (${name} ${username})
📦 *Item:* ${user.productType} Flash ${user.isDemo ? "*(DEMO)*" : ""}
🌐 *Paid Via:* ${user.payMethod}
💵 *Detected Amount:* $${extractedAmount} USDT
📝 *Submission Details:*
${text}`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✅ Approve", callback_data: `approve_${orderId}` },
              { text: "✏️ Edit Amount & Approve", callback_data: `editamount_${orderId}` }
            ],
            [{ text: "❌ Reject", callback_data: `reject_${orderId}` }]
          ]
        }
      }
    );
  }
});

// ---------------- ADMIN BLOCK COMMANDS ----------------
bot.onText(/\/block (\d+)/, async (msg, match) => {
  if (msg.chat.id != ADMIN_ID) return;
  const targetId = match[1];

  const target = await User.findOne({ chatId: targetId });
  if (!target) {
    return bot.sendMessage(ADMIN_ID, `❌ User with ID \`${targetId}\` not found.`, { parse_mode: "Markdown" });
  }

  target.isBlocked = true;
  target.step = null;
  await target.save();

  bot.sendMessage(ADMIN_ID, `🚫 User \`${targetId}\` has been **BLOCKED**. Any support or order attempt will show maintenance.`, { parse_mode: "Markdown" });
});

bot.onText(/\/unblock (\d+)/, async (msg, match) => {
  if (msg.chat.id != ADMIN_ID) return;
  const targetId = match[1];

  const target = await User.findOne({ chatId: targetId });
  if (!target) {
    return bot.sendMessage(ADMIN_ID, `❌ User with ID \`${targetId}\` not found.`, { parse_mode: "Markdown" });
  }

  target.isBlocked = false;
  await target.save();

  bot.sendMessage(ADMIN_ID, `✅ User \`${targetId}\` has been **UNBLOCKED**.`, { parse_mode: "Markdown" });
});

// ---------------- AUTOMATED HIGH-CONVERSION ENGINE ----------------
setInterval(async () => {
  try {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Upsell demo users to real packs
    const demoUsers = await User.find({
      isBlocked: { $ne: true },
      $or: [{ bep20DemoUsed: true }, { trc20DemoUsed: true }],
      hasRealOrder: false,
      demoCompletedAt: { $lte: twoHoursAgo },
      lastFollowupSent: { $ne: "demo_upsell" }
    });

    for (let u of demoUsers) {
      bot.sendMessage(u.chatId,
`⚡ *Your Demo Balance Was Delivered!*

Ready to scale up? High-liquidity batches are processing instantly today:
├ 💎 *$50 BEP-20* → $3,200 Flash Balance
└ 💎 *$100 BEP-20* → $6,500 Flash Balance

Tap /start to secure your standard pack!`, { parse_mode: "Markdown" }).catch(() => {});

      u.lastFollowupSent = "demo_upsell";
      await u.save();
    }
     // Reactivate $0 inactive leads
    const inactiveUsers = await User.find({
      isBlocked: { $ne: true },
      bep20DemoUsed: false,
      trc20DemoUsed: false,
      hasRealOrder: false,
      registeredAt: { $lte: oneDayAgo },
      lastFollowupSent: null
    });

    for (let u of inactiveUsers) {
      bot.sendMessage(u.chatId,
`👋 *Test Flash USDT with Zero Risk*

Verify our speed before ordering large tiers. Grab the **$2 BEP-20 Demo** or **$30 TRC-20 Demo** inside Support!

Tap /start to begin.`, { parse_mode: "Markdown" }).catch(() => {});

      u.lastFollowupSent = "inactive_nudged";
      await u.save();
    }
  } catch (err) {
    console.log("Auto follow-up error:", err);
  }
}, 30 * 60 * 1000);

// ---------------- MULTI-LINE BROADCAST COMMANDS ----------------
bot.onText(/\/broadcast ([\s\S]+)/, async (msg, match) => {
  if (msg.chat.id != ADMIN_ID) return;
  const text = match[1];
  const usersList = await User.find({ isBlocked: { $ne: true } });
  for (let u of usersList) {
    bot.sendMessage(u.chatId, `📢 ${text}`, { parse_mode: "Markdown" }).catch(() => {});
  }
  bot.sendMessage(ADMIN_ID, "✅ Broadcast sent to all");
});

bot.onText(/\/broadcast_all ([\s\S]+)/, async (msg, match) => {
  if (msg.chat.id != ADMIN_ID) return;
  const text = match[1];
  const list = await User.find({ isBlocked: { $ne: true } });
  for (let u of list) {
    bot.sendMessage(u.chatId, `📢 ${text}`, { parse_mode: "Markdown" }).catch(() => {});
  }
  bot.sendMessage(ADMIN_ID, `✅ Sent to ${list.length} users.`);
});

bot.onText(/\/broadcast_demo ([\s\S]+)/, async (msg, match) => {
  if (msg.chat.id != ADMIN_ID) return;
  const text = match[1];
  const list = await User.find({ isBlocked: { $ne: true }, $or: [{ bep20DemoUsed: true }, { trc20DemoUsed: true }], hasRealOrder: false });
  for (let u of list) {
    bot.sendMessage(u.chatId, `📢 ${text}`, { parse_mode: "Markdown" }).catch(() => {});
  }
  bot.sendMessage(ADMIN_ID, `✅ Sent to ${list.length} demo users.`);
});

bot.onText(/\/broadcast_inactive ([\s\S]+)/, async (msg, match) => {
  if (msg.chat.id != ADMIN_ID) return;
  const text = match[1];
  const list = await User.find({ isBlocked: { $ne: true }, bep20DemoUsed: false, trc20DemoUsed: false, hasRealOrder: false });
  for (let u of list) {
    bot.sendMessage(u.chatId, `📢 ${text}`, { parse_mode: "Markdown" }).catch(() => {});
  }
  bot.sendMessage(ADMIN_ID, `✅ Sent to ${list.length} inactive users.`);
});
