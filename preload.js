const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('db', {

  // LICENSE
  checkLicense: () => ipcRenderer.invoke('check-license'),
  activateLicense: (key) => ipcRenderer.invoke('activate-license', key),

  // CATEGORIES
  getCategories: () => ipcRenderer.invoke('get-categories'),
  addCategory: (name) => ipcRenderer.invoke('add-category', name),
  updateCategory: (id, name) => ipcRenderer.invoke('update-category', id, name),
  deleteCategory: (id) => ipcRenderer.invoke('delete-category', id),

  // PRODUCTS
  getProducts: () => ipcRenderer.invoke('get-products'),
  addProduct: (p) => ipcRenderer.invoke('add-product', p),
  updateProduct: (p) => ipcRenderer.invoke('update-product', p),
  deleteProduct: (id) => ipcRenderer.invoke('delete-product', id),
  updateStock: (id, s) => ipcRenderer.invoke('update-stock', id, s),
  assignBarcode: (id, code) => ipcRenderer.invoke('assign-barcode', id, code),
  getProductByBarcode: (code) => ipcRenderer.invoke('get-product-by-barcode', code),
  getProductBySerial: (serial) => ipcRenderer.invoke('get-product-by-serial', serial),

  // CUSTOMERS
  getCustomers: () => ipcRenderer.invoke('get-customers'),
  searchCustomers: (q) => ipcRenderer.invoke('search-customers', q),
  addCustomer: (c) => ipcRenderer.invoke('add-customer', c),
  updateCustomer: (c) => ipcRenderer.invoke('update-customer', c),
  deleteCustomer: (id) => ipcRenderer.invoke('delete-customer', id),
  getCustomerBills: (id) => ipcRenderer.invoke('get-customer-bills', id),
  updateCredit: (id, amt) => ipcRenderer.invoke('update-credit', id, amt),
  getCustomerByPhone: (phone) => ipcRenderer.invoke('get-customer-by-phone', phone),

  // BILLS
  saveBill: (b) => ipcRenderer.invoke('save-bill', b),
  getRevenueToday: () => ipcRenderer.invoke('get-revenue-today'),
  getAllBills: (l, o) => ipcRenderer.invoke('get-all-bills', l, o),
  getBillsCount: () => ipcRenderer.invoke('get-bills-count'),
  searchBills: (q) => ipcRenderer.invoke('search-bills', q),

  // ADMIN
  verifyAdminPassword: (pwd) => ipcRenderer.invoke('verify-admin-password', pwd),
  changeAdminPassword: (currentPassword, newPassword) => ipcRenderer.invoke('change-admin-password', currentPassword, newPassword),
  getStaff: () => ipcRenderer.invoke('get-staff'),
  addStaff: (s) => ipcRenderer.invoke('add-staff', s),
  updateStaff: (s) => ipcRenderer.invoke('update-staff', s),
  deleteStaff: (id) => ipcRenderer.invoke('delete-staff', id),
  getAttendance: (sId, d) => ipcRenderer.invoke('get-attendance', sId, d),
  markAttendance: (sId, d, st) => ipcRenderer.invoke('mark-attendance', sId, d, st),
  deleteBill: (id) => ipcRenderer.invoke('delete-bill', id),
  getSalaryReport: (m) => ipcRenderer.invoke('get-salary-report', m),

  // SETTINGS
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (s) => ipcRenderer.invoke('save-settings', s)
})
