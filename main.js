const { app, BrowserWindow, ipcMain } = require('electron')
const Database = require('better-sqlite3')
const path = require('path')
const fs = require('fs')
const { getMachineId, generateKey, validateKey } = require('./license')

let db
let mainWindow

// ---- LICENSE FILE ----
function getLicensePath() {
  return path.join(app.getPath('userData'), 'license.dat')
}

function readLicense() {
  try {
    const data = fs.readFileSync(getLicensePath(), 'utf8')
    return JSON.parse(data)
  } catch(e) {
    return null
  }
}

function writeLicense(data) {
  fs.writeFileSync(getLicensePath(), JSON.stringify(data), 'utf8')
}

function checkLicense() {
  const machineId = getMachineId()
  const license = readLicense()

  if (!license) {
    const trialData = {
      type: 'trial',
      startDate: new Date().toISOString(),
      machineId
    }
    writeLicense(trialData)
    return { status: 'trial', daysLeft: 7, machineId }
  }

  if (license.type === 'activated') {
    if (validateKey(license.key, machineId)) {
      return { status: 'activated', machineId }
    } else {
      return { status: 'invalid', machineId }
    }
  }

  if (license.type === 'trial') {
    const start = new Date(license.startDate)
    const now = new Date()
    const diffDays = Math.floor((now - start) / (1000 * 60 * 60 * 24))
    const daysLeft = 7 - diffDays

    if (daysLeft <= 0) {
      return { status: 'expired', machineId }
    }
    return { status: 'trial', daysLeft, machineId }
  }

  return { status: 'expired', machineId }
}

function activateLicense(key) {
  const machineId = getMachineId()
  if (validateKey(key, machineId)) {
    writeLicense({ type: 'activated', key, machineId, activatedAt: new Date().toISOString() })
    return { success: true }
  }
  return { success: false, error: 'Invalid activation key. Please check and try again.' }
}

// ---- AUTO-GENERATE HELPERS ----
function generateSerialNo() {
  const row = db.prepare(
    "SELECT MAX(CAST(serial_no AS INTEGER)) as maxSerial FROM products WHERE serial_no IS NOT NULL AND serial_no GLOB '[0-9]*'"
  ).get()
  return String((parseInt(row.maxSerial) || 0) + 1)
}

function generateBarcode() {
  // Generates a unique 13-digit EAN-style numeric barcode
  const ts = Date.now().toString().slice(-10)
  const rnd = Math.floor(100 + Math.random() * 900)
  return ts + rnd
}

// ---- DATABASE ----
function createDatabase() {
  db = new Database(path.join(app.getPath('userData'), 'freshmart.db'))

  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL
    );
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      cat TEXT NOT NULL,
      price REAL NOT NULL,
      gst INTEGER NOT NULL,
      stock INTEGER NOT NULL DEFAULT 0,
      barcode TEXT UNIQUE,
      serial_no TEXT UNIQUE
    );
    CREATE TABLE IF NOT EXISTS staff (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT UNIQUE,
      position TEXT,
      salary REAL NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      staff_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      status TEXT NOT NULL,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(staff_id, date),
      FOREIGN KEY(staff_id) REFERENCES staff(id)
    );
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT UNIQUE,
      address TEXT,
      credit_balance REAL NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS bills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_name TEXT,
      customer_phone TEXT,
      subtotal REAL,
      gst_amount REAL,
      discount REAL,
      grand_total REAL,
      payment_mode TEXT,
      items_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `)

  // Migrations — run FIRST before anything else touches the schema
  try { db.exec('ALTER TABLE products ADD COLUMN barcode TEXT UNIQUE') } catch(e) {}
  try { db.exec('ALTER TABLE products ADD COLUMN serial_no TEXT UNIQUE') } catch(e) {}
  try { db.exec('ALTER TABLE bills ADD COLUMN items_json TEXT') } catch(e) {}
  try { db.exec('ALTER TABLE bills ADD COLUMN customer_id INTEGER') } catch(e) {}

  // Add settings table and seed defaults
  db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`)
  const defaultSettings = { shopName: "PM Supermarket", shopAddress: "Paarai palli busstand opposite, Madhavalayam, 629302", shopGstin: "XXXXXXXXXXXXXXX", shopPhone: "", adminPassword: "1234" }
  const insertSetting = db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)")
  Object.entries(defaultSettings).forEach(([k, v]) => insertSetting.run(k, v))

  // Backfill serial_no for existing products that are missing them (incrementing)
  const productsWithoutSerial = db.prepare('SELECT id FROM products WHERE serial_no IS NULL ORDER BY id').all()
  const updateSerial = db.prepare('UPDATE products SET serial_no=? WHERE id=?')
  for (const row of productsWithoutSerial) {
    const serial = generateSerialNo()   // reads MAX from db each time, so increments correctly
    updateSerial.run(serial, row.id)
  }

  const productsWithoutBarcode = db.prepare('SELECT id FROM products WHERE barcode IS NULL').all()
  const updateBarcode = db.prepare('UPDATE products SET barcode=? WHERE id=?')
  for (const row of productsWithoutBarcode) {
    let barcode
    let attempts = 0
    do {
      barcode = generateBarcode()
      attempts++
    } while (db.prepare('SELECT id FROM products WHERE barcode=?').get(barcode) && attempts < 20)
    updateBarcode.run(barcode, row.id)
  }

  // Seed categories
  const catCount = db.prepare('SELECT COUNT(*) as c FROM categories').get()
  if (catCount.c === 0) {
    const cats = ['Staples & Grains','Edible Oils','Spices & Masalas','Dairy & Eggs','Packaged Foods','Snacks','Beverages','Personal Care','Household','Baby Care']
    const insert = db.prepare('INSERT INTO categories (name) VALUES (?)')
    cats.forEach(c => insert.run(c))
  }

  // Seed default products
  const prodCount = db.prepare('SELECT COUNT(*) as c FROM products').get()
  if (prodCount.c === 0) {
    const insert = db.prepare('INSERT INTO products (name, cat, price, gst, stock, barcode, serial_no) VALUES (?, ?, ?, ?, ?, ?, ?)')
    const defaults = [
      ['Tata Salt 1kg','Staples & Grains',24,0,100,'8901058000112'],
      ['Aashirvaad Atta 5kg','Staples & Grains',275,0,60,'8901058001234'],
      ['Fortune Rice 5kg','Staples & Grains',320,0,80,'8901058002345'],
      ['Toor Dal 1kg','Staples & Grains',160,0,75,'8901058003456'],
      ['Sunflower Oil 1L','Edible Oils',185,5,50,'8901058004567'],
      ['Amul Ghee 500ml','Edible Oils',320,12,40,'8901058005678'],
      ['MDH Garam Masala','Spices & Masalas',85,5,90,'8901058006789'],
      ['Turmeric Powder 200g','Spices & Masalas',48,5,110,'8901058007890'],
      ['Amul Milk 1L','Dairy & Eggs',68,0,200,'8901058008901'],
      ['Amul Butter 500g','Dairy & Eggs',280,12,45,'8901058009012'],
      ['Amul Curd 400g','Dairy & Eggs',46,5,60,'8901058010123'],
      ['Eggs 12pcs','Dairy & Eggs',96,0,150,'8901058011234'],
      ['Britannia Biscuits','Packaged Foods',35,18,120,'8901058012345'],
      ['Maggi Noodles 70g','Packaged Foods',14,18,200,'8901058013456'],
      ["Lay's Chips 50g",'Snacks',20,12,180,'8901058014567'],
      ['Kurkure 80g','Snacks',30,12,160,'8901058015678'],
      ['Bisleri Water 1L','Beverages',20,12,300,'8901058016789'],
      ['Coca-Cola 600ml','Beverages',40,28,100,'8901058017890'],
      ['Tata Tea 250g','Beverages',130,5,70,'8901058018901'],
      ['Colgate Toothpaste 200g','Personal Care',98,18,80,'8901058019012'],
      ['Dove Soap 100g','Personal Care',65,18,90,'8901058020123'],
      ['Ariel Detergent 1kg','Household',199,18,55,'8901058021234'],
      ['Harpic 500ml','Household',135,18,40,'8901058022345'],
      ['Pampers Diapers S 20pc','Baby Care',399,12,30,'8901058023456'],
    ]
    defaults.forEach((d, i) => {
      insert.run(...d, String(i + 1))
    })
  }
}

// ---- IPC: LICENSE ----
ipcMain.handle('check-license', () => checkLicense())
ipcMain.handle('activate-license', (_, key) => activateLicense(key))

// ---- IPC: CATEGORIES ----
ipcMain.handle('get-categories', () => db.prepare('SELECT * FROM categories ORDER BY name').all())
ipcMain.handle('add-category', (_, name) => {
  try { db.prepare('INSERT INTO categories (name) VALUES (?)').run(name); return { success: true } }
  catch(e) { return { success: false, error: 'Category already exists' } }
})
ipcMain.handle('update-category', (_, id, name) => {
  try {
    const cleanName = String(name || '').trim()
    if (!cleanName) return { success: false, error: 'Category name cannot be empty' }
    const old = db.prepare('SELECT name FROM categories WHERE id=?').get(id)
    if (!old) return { success: false, error: 'Category not found' }
    db.prepare('UPDATE categories SET name=? WHERE id=?').run(cleanName, id)
    db.prepare('UPDATE products SET cat=? WHERE cat=?').run(cleanName, old.name)
    return { success: true }
  } catch (e) {
    return { success: false, error: 'Category already exists or could not be updated' }
  }
})
ipcMain.handle('delete-category', (_, id) => {
  try {
    const category = db.prepare('SELECT name FROM categories WHERE id=?').get(id)
    if (!category) return { success: false, error: 'Category not found' }
    const used = db.prepare('SELECT COUNT(*) AS count FROM products WHERE cat=?').get(category.name).count
    if (used > 0) return { success: false, error: `Cannot delete "${category.name}" because ${used} product(s) use this category. Move those products first.` }
    db.prepare('DELETE FROM categories WHERE id=?').run(id)
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
})

// ---- IPC: PRODUCTS ----
ipcMain.handle('get-products', () => db.prepare('SELECT * FROM products ORDER BY name').all())

ipcMain.handle('add-product', (_, p) => {
  // Auto-generate serial number — always unique
  let serialNo
  let serialAttempts = 0
  do {
    serialNo = generateSerialNo()
    serialAttempts++
  } while (db.prepare('SELECT id FROM products WHERE serial_no=?').get(serialNo) && serialAttempts < 20)

  // Auto-generate barcode if not provided by user
  let barcode = (p.barcode && p.barcode.trim()) ? p.barcode.trim() : null
  if (!barcode) {
    let barcodeAttempts = 0
    do {
      barcode = generateBarcode()
      barcodeAttempts++
    } while (db.prepare('SELECT id FROM products WHERE barcode=?').get(barcode) && barcodeAttempts < 20)
  }

  try {
    db.prepare('INSERT INTO products (name, cat, price, gst, stock, barcode, serial_no) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(p.name, p.cat, p.price, p.gst, p.stock, barcode, serialNo)
    return { success: true, serialNo, barcode }
  } catch(e) {
    return { success: false, error: e.message }
  }
})

ipcMain.handle('update-product', (_, p) => {
  try {
    db.prepare('UPDATE products SET name=?, cat=?, price=?, gst=?, stock=?, barcode=?, serial_no=? WHERE id=?')
      .run(p.name, p.cat, p.price, p.gst, p.stock, p.barcode || null, p.serial_no || null, p.id)
    return { success: true }
  } catch(e) {
    return { success: false, error: e.message }
  }
})

ipcMain.handle('delete-product', (_, id) => { db.prepare('DELETE FROM products WHERE id=?').run(id); return { success: true } })
ipcMain.handle('update-stock', (_, id, newStock) => { db.prepare('UPDATE products SET stock=? WHERE id=?').run(newStock, id); return { success: true } })

ipcMain.handle('assign-barcode', (_, id, barcode) => {
  try { db.prepare('UPDATE products SET barcode=? WHERE id=?').run(barcode, id); return { success: true } }
  catch(e) { return { success: false, error: 'Barcode already assigned to another product' } }
})

// Search by barcode OR serial number
ipcMain.handle('get-product-by-barcode', (_, code) =>
  db.prepare('SELECT * FROM products WHERE barcode=? OR serial_no=?').get(code, code) || null
)

ipcMain.handle('get-product-by-serial', (_, serial) =>
  db.prepare('SELECT * FROM products WHERE serial_no=?').get(serial) || null
)

// ---- IPC: BILLS ----
ipcMain.handle('save-bill', (_, bill) => {
  db.prepare('INSERT INTO bills (customer_name, customer_phone, customer_id, subtotal, gst_amount, discount, grand_total, payment_mode, items_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    bill.customerName, bill.customerPhone, bill.customerId || null, bill.subtotal, bill.gstAmount, bill.discount, bill.grandTotal, bill.paymentMode, bill.itemsJson
  )
  return { success: true }
})
ipcMain.handle('get-revenue-today', () => db.prepare("SELECT COALESCE(SUM(grand_total),0) as total, COUNT(*) as count FROM bills WHERE date(created_at) = date('now','localtime')").get())
ipcMain.handle('get-all-bills', (_, limit, offset) => db.prepare('SELECT * FROM bills ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset))
ipcMain.handle('get-bills-count', () => db.prepare('SELECT COUNT(*) as count FROM bills').get())
ipcMain.handle('search-bills', (_, q) => db.prepare("SELECT * FROM bills WHERE customer_name LIKE ? OR customer_phone LIKE ? OR id = ? ORDER BY created_at DESC LIMIT 50").all(`%${q}%`, `%${q}%`, parseInt(q)||0))


// ---- IPC: ADMIN ----
ipcMain.handle('verify-admin-password', (_, pwd) => {
  const setting = db.prepare('SELECT value FROM settings WHERE key = ?').get('adminPassword')
  return pwd === setting.value
})

ipcMain.handle('change-admin-password', (_, currentPassword, newPassword) => {
  try {
    const setting = db.prepare('SELECT value FROM settings WHERE key=?').get('adminPassword')
    if (!setting) return { success: false, error: 'Admin password setting not found' }
    if (currentPassword !== setting.value) return { success: false, error: 'Current password is incorrect' }
    if (!newPassword || String(newPassword).length < 4) return { success: false, error: 'New password must contain at least 4 characters' }
    db.prepare('UPDATE settings SET value=? WHERE key=?').run(String(newPassword), 'adminPassword')
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
})

ipcMain.handle('get-staff', () => db.prepare('SELECT * FROM staff ORDER BY name').all())

ipcMain.handle('add-staff', (_, s) => {
  try {
    db.prepare('INSERT INTO staff (name, phone, position, salary) VALUES (?, ?, ?, ?)').run(s.name, s.phone || null, s.position || null, s.salary || 0)
    return { success: true }
  } catch(e) { return { success: false, error: 'Phone already exists' } }
})

ipcMain.handle('update-staff', (_, s) => {
  try {
    db.prepare('UPDATE staff SET name=?, phone=?, position=?, salary=?, is_active=? WHERE id=?').run(s.name, s.phone || null, s.position || null, s.salary || 0, s.is_active ? 1 : 0, s.id)
    return { success: true }
  } catch(e) { return { success: false, error: 'Phone already exists' } }
})

ipcMain.handle('delete-staff', (_, id) => {
  db.prepare('DELETE FROM staff WHERE id=?').run(id)
  db.prepare('DELETE FROM attendance WHERE staff_id=?').run(id)
  return { success: true }
})

ipcMain.handle('get-attendance', (_, staffId, date) => {
  if (staffId && date) {
    return db.prepare('SELECT * FROM attendance WHERE staff_id=? AND date=?').get(staffId, date) || null
  } else if (staffId) {
    return db.prepare('SELECT * FROM attendance WHERE staff_id=? ORDER BY date DESC LIMIT 30').all(staffId)
  } else if (date) {
    return db.prepare('SELECT a.*, s.name FROM attendance a JOIN staff s ON a.staff_id=s.id WHERE a.date=? ORDER BY s.name').all(date)
  }
  return []
})

ipcMain.handle('mark-attendance', (_, staffId, date, status) => {
  try {
    db.prepare('INSERT OR REPLACE INTO attendance (staff_id, date, status) VALUES (?, ?, ?)').run(staffId, date, status)
    return { success: true }
  } catch(e) { return { success: false, error: e.message } }
})

ipcMain.handle('delete-bill', (_, billId) => {
  db.prepare('DELETE FROM bills WHERE id=?').run(billId)
  return { success: true }
})

ipcMain.handle('get-salary-report', (_, month) => {
  try {
    if (!month || !/^\d{4}-\d{2}$/.test(month)) throw new Error('Invalid month')
    const staff = db.prepare('SELECT * FROM staff WHERE is_active=1 ORDER BY name').all()
    const [year, monthNumber] = month.split('-').map(Number)
    const startDate = `${year}-${String(monthNumber).padStart(2,'0')}-01`
    const lastDay = new Date(year, monthNumber, 0).getDate()
    const endDate = `${year}-${String(monthNumber).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`
    return staff.map(s => {
      const attendanceDays = db.prepare(`
        SELECT COUNT(*) AS count FROM attendance
        WHERE staff_id=? AND date BETWEEN ? AND ?
        AND status NOT IN ('Absent','Leave')
      `).get(s.id, startDate, endDate).count
      return { ...s, attendanceDays, totalSalary: (Number(s.salary)/30) * attendanceDays }
    })
  } catch (e) {
    console.error('get-salary-report error:', e)
    throw e
  }
})

// ---- IPC: CUSTOMERS ----
ipcMain.handle('get-customers', () => db.prepare('SELECT * FROM customers ORDER BY name').all())

ipcMain.handle('search-customers', (_, q) =>
  db.prepare("SELECT * FROM customers WHERE name LIKE ? OR phone LIKE ? LIMIT 10").all(`%${q}%`, `%${q}%`)
)

ipcMain.handle('add-customer', (_, c) => {
  try {
    db.prepare('INSERT INTO customers (name, phone, address) VALUES (?, ?, ?)').run(c.name, c.phone || null, c.address || null)
    return { success: true }
  } catch(e) {
    return { success: false, error: 'Phone number already exists for another customer' }
  }
})

ipcMain.handle('update-customer', (_, c) => {
  try {
    db.prepare('UPDATE customers SET name=?, phone=?, address=? WHERE id=?').run(c.name, c.phone || null, c.address || null, c.id)
    return { success: true }
  } catch(e) {
    return { success: false, error: 'Phone number already exists for another customer' }
  }
})

ipcMain.handle('delete-customer', (_, id) => {
  db.prepare('DELETE FROM customers WHERE id=?').run(id)
  return { success: true }
})

ipcMain.handle('get-customer-bills', (_, customerId) =>
  db.prepare('SELECT * FROM bills WHERE customer_id=? ORDER BY created_at DESC').all(customerId)
)

ipcMain.handle('update-credit', (_, customerId, amount) => {
  db.prepare('UPDATE customers SET credit_balance = credit_balance + ? WHERE id=?').run(amount, customerId)
  return { success: true }
})

ipcMain.handle('get-customer-by-phone', (_, phone) =>
  db.prepare('SELECT * FROM customers WHERE phone=?').get(phone) || null
)

// ---- IPC: SETTINGS ----
ipcMain.handle("get-settings", () => {
  const rows = db.prepare("SELECT key, value FROM settings").all()
  const out = {}
  rows.forEach(r => out[r.key] = r.value)
  return out
})
ipcMain.handle("save-settings", (_, settings) => {
  const upsert = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
  Object.entries(settings).forEach(([k, v]) => upsert.run(k, v))
  return { success: true }
})
// ---- WINDOW ----
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 800,
    title: 'SS Billing',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  })
  mainWindow.loadFile('index.html')
}

app.whenReady().then(() => {
  createDatabase()
  createWindow()
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })