const STORAGE_KEY = "gcash-business-ledger";
const OPENING_BALANCE_STORAGE_KEY = "gcash-business-ledger-opening-balances";
const STARTING_CASH_ON_HAND = 5000;
const STARTING_GCASH_AVAILABLE = 5000;
const MASKED_OWNER_NAME = "KR.....E B.. R.";

const form = document.getElementById("transactionForm");
const receiptInput = document.getElementById("receiptInput");
const modeBadge = document.getElementById("modeBadge");
const receiptPreview = document.getElementById("receiptPreview");
const receiptPreviewWrap = document.getElementById("receiptPreviewWrap");
const clearReceiptBtn = document.getElementById("clearReceiptBtn");
const tableBody = document.getElementById("transactionsTableBody");
const transactionCount = document.getElementById("transactionCount");
const detectedType = document.getElementById("detectedType");
const detectedAmount = document.getElementById("detectedAmount");
const detectedName = document.getElementById("detectedName");
const cashOnHand = document.getElementById("cashOnHand");
const gcashAvailable = document.getElementById("gcashAvailable");
const detectedFee = document.getElementById("detectedFee");
const ocrStatus = document.getElementById("ocrStatus");
const resetBtn = document.getElementById("resetBtn");
const proceedBalanceEdit = document.getElementById("proceedBalanceEdit");
const balanceEditor = document.getElementById("balanceEditor");
const openingCashInput = document.getElementById("openingCashInput");
const openingGcashInput = document.getElementById("openingGcashInput");
const cancelBalanceEdit = document.getElementById("cancelBalanceEdit");

let activeReceiptDataUrl = "";
let currentResult = {
  type: "cashin",
  amount: 0,
  fee: 0,
  name: "",
  cashOnHand: 0,
  gcashAvailable: 0,
  notes: ""
};

function formatCurrency(value) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP"
  }).format(Number(value || 0));
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function loadOpeningBalances() {
  try {
    const saved = JSON.parse(localStorage.getItem(OPENING_BALANCE_STORAGE_KEY) || "{}");
    const cashOnHand = Number(saved.cashOnHand ?? STARTING_CASH_ON_HAND);
    const gcashAvailable = Number(saved.gcashAvailable ?? STARTING_GCASH_AVAILABLE);

    return {
      cashOnHand: Number.isFinite(cashOnHand) ? cashOnHand : STARTING_CASH_ON_HAND,
      gcashAvailable: Number.isFinite(gcashAvailable) ? gcashAvailable : STARTING_GCASH_AVAILABLE
    };
  } catch (error) {
    console.error("Failed to load opening balances", error);
    return { cashOnHand: STARTING_CASH_ON_HAND, gcashAvailable: STARTING_GCASH_AVAILABLE };
  }
}

let openingBalances = loadOpeningBalances();

function calculateFee(amount) {
  const value = Number(amount || 0);
  if (value <= 0) return 0;
  if (value <= 500) return 5;
  if (value <= 1000) return 10;
  return Math.ceil(value / 1000) * 10;
}

function normalizeAmount(value) {
  if (value === null || value === undefined || value === "") return 0;

  const cleaned = String(value)
    .replace(/(?:₱|php)/gi, "")
    .replace(/[^0-9.\-]/g, "")
    .trim();

  const asNumber = Number(cleaned);
  return Number.isFinite(asNumber) ? asNumber : 0;
}

function isLikelyDate(value) {
  return Number.isInteger(value) && value >= 1900 && value <= 2100;
}

function toNumberCandidates(line) {
  const matches = [...String(line || "").matchAll(/(?:₱|Php|PHP|P)?\s*(?:\d{1,3}(?:,\d{3})+|\d{1,7})(?:\.\d{2})?/g)];

  return matches
    .map((match) => normalizeAmount(match[0]))
    .filter((amount) => amount > 9 && amount < 5000000 && !isLikelyDate(amount));
}

function getReceiptRelevanceScore(line, amount) {
  const lower = String(line || "").toLowerCase();
  let score = 0;

  if (/amount|amt|total|paid|received|sent|withdraw|deposit|transfer|balance|available|wallet|cash\s*in|cash\s*out/i.test(lower)) score += 10;
  if (/cash\s*in|received|deposit|credited|load|top\s*up|incoming|credit/i.test(lower)) score += 13;
  if (/cash\s*out|withdraw|sent|paid|debit|payout|outgoing|transfer\s*out/i.test(lower)) score += 13;
  if (/(?:₱|php|p)/i.test(lower)) score += 6;
  if (/\b\d{2,4}[-/]\d{1,2}[-/]\d{1,2}\b|\b\d{1,2}:\d{2}\b/.test(lower)) score -= 7;
  if (/trx|ref|reference|id\b/i.test(lower)) score -= 8;
  if (amount >= 1000) score += 3;
  if (amount >= 5000) score += 3;

  return score;
}

function pickBestAmount(lines, preferredType) {
  let bestTransaction = 0;
  let bestBalance = 0;

  for (const line of lines) {
    const lower = line.toLowerCase();
    const amounts = toNumberCandidates(line);
    if (!amounts.length) continue;

    const amount = Math.max(...amounts);
    const isBalance = /balance|available|wallet|cash\s*on\s*hand|cash\s*in\s*hand/i.test(lower);
    const isPreferredType = preferredType === "cashin"
      ? /cash\s*in|received|deposit|credited|load|top\s*up|added|incoming|credit/i.test(lower)
      : /cash\s*out|withdraw|sent|paid|deduct|outgoing|debit|transfer\s*out|cashout|payout/i.test(lower);

    if (isBalance) {
      bestBalance = Math.max(bestBalance, amount);
      continue;
    }

    if (isPreferredType || /amount|amt|total|paid|received|sent|deposit|withdraw|transfer/i.test(lower)) {
      bestTransaction = Math.max(bestTransaction, amount);
    }
  }

  if (bestTransaction > 0) return bestTransaction;
  if (bestBalance > 0) return bestBalance;

  const fallback = toNumberCandidates(String(lines.join("\n")).replace(/\b(20\d{2}|19\d{2})\b/g, ""));
  return fallback.length ? Math.max(...fallback) : 0;
}

function determineType(text) {
  const lower = String(text || "").toLowerCase();
  const lines = String(text || "").split(/\r?\n|\s{2,}/);
  let cashInScore = 0;
  let cashOutScore = 0;

  for (const line of lines) {
    const lowerLine = line.toLowerCase();
    const hasAmount = toNumberCandidates(line).length > 0;

    if (!hasAmount && !/(cash|received|sent|withdraw|deposit|paid|transfer|amount|balance|available)/i.test(lowerLine)) {
      continue;
    }

    if (/cash\s*in|received|deposit|credited|load|top\s*up|added|incoming|credit/i.test(lowerLine)) cashInScore += 4;
    if (/cash\s*out|withdraw|sent|paid|deduct|outgoing|debit|transfer\s*out|cashout/i.test(lowerLine)) cashOutScore += 4;
    if (/amount|balance|available|wallet|gcash/i.test(lowerLine)) {
      if (/received|credit|deposit|cash\s*in/i.test(lowerLine)) cashInScore += 1;
      if (/sent|paid|withdraw|cash\s*out/i.test(lowerLine)) cashOutScore += 1;
    }
  }

  if (cashOutScore > cashInScore) return "cashout";
  if (cashInScore > cashOutScore) return "cashin";

  if (/cash\s*in|deposit|received|credited|load|top[- ]?up|added/i.test(lower)) return "cashin";
  if (/cash\s*out|withdraw|sent|paid|transfer\s*out|cashout|outgoing|deduct/i.test(lower)) return "cashout";

  return "cashin";
}

function determineBalanceValues(text, amount) {
  const lines = String(text || "").split(/\r?\n|\s{2,}/);

  const findValue = (pattern) => {
    for (const line of lines) {
      const match = line.match(pattern);
      if (match) {
        const value = normalizeAmount(match[1]);
        if (value > 0 && !isLikelyDate(value)) return value;
      }
    }
    return amount;
  };

  const availableBalance = findValue(/(?:available|gcash|wallet|balance)[^\n\r]{0,30}(?:₱|Php|PHP|P)?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\d{1,7}(?:\.\d{2})?)/i);
  const cashOnHandValue = findValue(/(?:cash\s*on\s*hand|cash\s*in\s*hand|hand\s*cash)[^\n\r]{0,30}(?:₱|Php|PHP|P)?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\d{1,7}(?:\.\d{2})?)/i);

  return {
    cashOnHand: cashOnHandValue,
    gcashAvailable: availableBalance
  };
}

function extractCustomerName(text) {
  const lines = String(text || "")
    .replace(/\r/g, "\n")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const labelPattern = /^(?:recipient(?:\s*name)?|receiver|customer|account\s*name|sent\s*to|send(?:\s+money)?\s+to|paid\s*to|transfer(?:red)?\s*to|to|name)\s*[:\-]?\s*(.*)$/i;
  const ownerName = "Kristine Bea Rosete".toLowerCase().replace(/[^a-z]/g, "");

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(labelPattern);
    if (!match) continue;

    let candidate = match[1].replace(/\s+(?:mobile|phone|number|ref|reference|date|amount|fee)\b.*$/i, "").trim();
    if (!candidate && lines[index + 1]) candidate = lines[index + 1];
    candidate = candidate.replace(/\s+\+?[\d][\d\s-]*$/, "").trim();

    const validName = candidate.match(/^([A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){1,3})$/);
    if (!validName) continue;

    const name = validName[1].replace(/\s+/g, " ").trim();
    if (name.toLowerCase().replace(/[^a-z]/g, "") === ownerName) continue;
    return name;
  }

  return "Customer name not detected";
}

function parseReceiptText(text) {
  const cleanText = String(text || "").replace(/\r/g, "\n").replace(/[ \t]+/g, " ").trim();
  const lines = cleanText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const type = determineType(cleanText);
  const amount = pickBestAmount(lines, type);
  const balance = determineBalanceValues(cleanText, amount);
  const name = type === "cashin" ? MASKED_OWNER_NAME : extractCustomerName(cleanText);

  return {
    type,
    amount,
    name,
    cashOnHand: balance.cashOnHand,
    gcashAvailable: balance.gcashAvailable,
    notes: cleanText.slice(0, 200) || "Receipt detected automatically"
  };
}

async function recognizeReceipt(file) {
  if (!file || !file.type.startsWith("image/")) {
    alert("Please upload a valid image file.");
    return;
  }

  if (file.size > 8 * 1024 * 1024) {
    alert("Image is too large. Please use an image under 8MB.");
    return;
  }

  const reader = new FileReader();
  reader.onload = async () => {
    const imageDataUrl = String(reader.result || "");
    activeReceiptDataUrl = imageDataUrl;
    receiptPreview.src = imageDataUrl;
    receiptPreviewWrap.classList.remove("hidden");
    receiptPreviewWrap.classList.add("is-reading");
    ocrStatus.textContent = "Reading receipt...";

    try {
      const result = await Tesseract.recognize(imageDataUrl, "eng", {
        logger: (message) => {
          if (message && message.status === "recognizing text") {
            ocrStatus.textContent = `Reading receipt... ${Math.round((message.progress || 0) * 100)}%`;
          }
        }
      });

      currentResult = parseReceiptText(result.data.text || "");
      currentResult.fee = calculateFee(currentResult.amount);
      const typeText = currentResult.type === "cashin" ? "Cash In" : "Cash Out";
      const ledger = calculateLedger(getTransactions());
      const cashDelta = currentResult.type === "cashin" ? currentResult.amount : -currentResult.amount;
      const gcashDelta = -cashDelta;

      detectedType.textContent = typeText;
      detectedAmount.textContent = formatCurrency(currentResult.amount);
      detectedName.textContent = currentResult.name;
      detectedFee.textContent = formatCurrency(currentResult.fee);
      cashOnHand.textContent = formatCurrency(ledger.cashOnHand + cashDelta);
      gcashAvailable.textContent = formatCurrency(ledger.gcashAvailable + gcashDelta);
      modeBadge.textContent = typeText;
      modeBadge.classList.toggle("cash-in", currentResult.type === "cashin");
      modeBadge.classList.toggle("cash-out", currentResult.type === "cashout");
      receiptPreviewWrap.classList.remove("is-reading");
      ocrStatus.textContent = `Receipt read successfully. ${typeText} detected.`;
    } catch (error) {
      console.error(error);
      receiptPreviewWrap.classList.remove("is-reading");
      detectedType.textContent = "Unknown";
      detectedAmount.textContent = "₱0.00";
      detectedName.textContent = "Name not detected";
      cashOnHand.textContent = "₱0.00";
      gcashAvailable.textContent = "₱0.00";
      detectedFee.textContent = "₱0.00";
      ocrStatus.textContent = "Unable to read this image. Please try another receipt.";
    }
  };

  reader.readAsDataURL(file);
}

const clearReceiptSelection = () => {
  activeReceiptDataUrl = "";
  currentResult = {
    type: "cashin",
    amount: 0,
    fee: 0,
    name: "",
    cashOnHand: 0,
    gcashAvailable: 0,
    notes: ""
  };

  if (receiptInput) receiptInput.value = "";
  receiptPreview.src = "";
  receiptPreviewWrap.classList.add("hidden");
  receiptPreviewWrap.classList.remove("is-reading");
  detectedType.textContent = "Waiting for receipt";
  detectedAmount.textContent = "₱0.00";
  detectedName.textContent = "Waiting for receipt";
  cashOnHand.textContent = "₱0.00";
  gcashAvailable.textContent = "₱0.00";
  detectedFee.textContent = "₱0.00";
  const ledger = calculateLedger(getTransactions());
  cashOnHand.textContent = formatCurrency(ledger.cashOnHand);
  gcashAvailable.textContent = formatCurrency(ledger.gcashAvailable);
  modeBadge.textContent = "Cash In";
  modeBadge.classList.remove("cash-out");
  modeBadge.classList.add("cash-in");
  ocrStatus.textContent = "Ready to read receipt.";
};

const getTransactions = () => {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([]));
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error("Failed to parse transactions", error);
    return [];
  }
};

const saveTransactions = (transactions) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
};

const calculateLedger = (transactions) => {
  const ordered = [...transactions].sort((a, b) => new Date(a.date) - new Date(b.date));
  const balances = new Map();
  let totalCashIn = 0;
  let totalCashOut = 0;
  let earnings = 0;
  let cashOnHand = openingBalances.cashOnHand;
  let gcashAvailable = openingBalances.gcashAvailable;

  for (const item of ordered) {
    const amount = Math.max(0, Number(item.amount || 0));
    const fee = Number(item.fee) > 0 ? Number(item.fee) : calculateFee(amount);

    if (item.type === "cashout") {
      totalCashOut += amount;
      cashOnHand -= amount;
      gcashAvailable += amount;
    } else {
      totalCashIn += amount;
      cashOnHand += amount;
      gcashAvailable -= amount;
    }

    earnings += fee;
    balances.set(item, { cashOnHand, gcashAvailable, fee });
  }

  return { totalCashIn, totalCashOut, cashOnHand, gcashAvailable, earnings, balances };
};

const renderReceiptBalances = () => {
  const ledger = calculateLedger(getTransactions());
  const amount = Number(currentResult.amount || 0);
  const cashDelta = currentResult.type === "cashin" ? amount : -amount;

  cashOnHand.textContent = formatCurrency(ledger.cashOnHand + cashDelta);
  gcashAvailable.textContent = formatCurrency(ledger.gcashAvailable - cashDelta);
};

const renderTable = (transactions) => {
  if (!transactions.length) {
    tableBody.innerHTML = '<tr class="empty-activity-row"><td colspan="7" class="empty-row">No receipt entries recorded yet.</td></tr>';
    return;
  }

  const rows = [...transactions]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .map((item) => {
      const isCashIn = item.type === "cashin";
      const fee = Number(item.fee) > 0 ? Number(item.fee) : calculateFee(item.amount);
      const receiptMarkup = item.receipt ? `<img class="proof-thumb" src="${item.receipt}" alt="Receipt proof" />` : "—";

      return `
        <tr>
          <td data-label="Date">${item.date}</td>
          <td data-label="Type"><span class="type-pill ${item.type}">${isCashIn ? "Cash In" : "Cash Out"}</span></td>
          <td data-label="Customer">${escapeHtml(item.name || "Name not detected")}</td>
          <td data-label="Amount">${formatCurrency(item.amount)}</td>
          <td data-label="Fee">${formatCurrency(fee)}</td>
          <td data-label="Proof">${receiptMarkup}</td>
          <td data-label="Notes">${item.notes || "Receipt auto-read"}</td>
        </tr>
      `;
    })
    .join("");

  tableBody.innerHTML = rows;
};

const renderSummary = () => {
  const transactions = getTransactions();
  const stats = calculateLedger(transactions);

  document.getElementById("totalCashIn").textContent = formatCurrency(stats.totalCashIn);
  document.getElementById("totalCashOut").textContent = formatCurrency(stats.totalCashOut);
  document.getElementById("summaryCashOnHand").textContent = formatCurrency(stats.cashOnHand);
  document.getElementById("summaryGcashAvailable").textContent = formatCurrency(stats.gcashAvailable);
  document.getElementById("totalEarnings").textContent = formatCurrency(stats.earnings);
  transactionCount.textContent = `${transactions.length} ${transactions.length === 1 ? "entry" : "entries"}`;

  renderTable(transactions);
  renderReceiptBalances();
};

const closeBalanceEditor = () => {
  balanceEditor.hidden = true;
  proceedBalanceEdit.setAttribute("aria-expanded", "false");
};

proceedBalanceEdit.addEventListener("click", () => {
  const currentBalances = calculateLedger(getTransactions());
  openingCashInput.value = currentBalances.cashOnHand;
  openingGcashInput.value = currentBalances.gcashAvailable;
  balanceEditor.hidden = false;
  proceedBalanceEdit.setAttribute("aria-expanded", "true");
});

balanceEditor.addEventListener("submit", (event) => {
  event.preventDefault();

  const transactions = getTransactions();
  const currentBalances = calculateLedger(transactions);
  const cashMovement = currentBalances.cashOnHand - openingBalances.cashOnHand;
  const gcashMovement = currentBalances.gcashAvailable - openingBalances.gcashAvailable;

  openingBalances = {
    cashOnHand: Number(openingCashInput.value) - cashMovement,
    gcashAvailable: Number(openingGcashInput.value) - gcashMovement
  };
  localStorage.setItem(OPENING_BALANCE_STORAGE_KEY, JSON.stringify(openingBalances));
  closeBalanceEditor();
  renderSummary();
});

cancelBalanceEdit.addEventListener("click", closeBalanceEditor);

form.addEventListener("submit", (event) => {
  event.preventDefault();

  if (!activeReceiptDataUrl || currentResult.amount <= 0) {
    alert("Please upload a receipt and allow it to be read before saving.");
    return;
  }

  const transactions = getTransactions();
  const newEntry = {
    id: crypto.randomUUID(),
    type: currentResult.type,
    name: currentResult.name,
    date: new Date().toISOString().slice(0, 10),
    amount: Number(currentResult.amount || 0),
    fee: calculateFee(currentResult.amount),
    notes: currentResult.notes,
    receipt: activeReceiptDataUrl
  };

  transactions.push(newEntry);
  saveTransactions(transactions);
  clearReceiptSelection();
  renderSummary();
  ocrStatus.textContent = "Receipt entry saved successfully.";
});

receiptInput.addEventListener("change", (event) => {
  const file = event.target.files && event.target.files[0];
  if (file) recognizeReceipt(file);
});

clearReceiptBtn.addEventListener("click", clearReceiptSelection);
resetBtn.addEventListener("click", clearReceiptSelection);

renderSummary();
clearReceiptSelection();
