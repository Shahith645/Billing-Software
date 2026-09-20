// Run this on YOUR computer to generate keys for customers
// Usage: node keygen.js <machineId>
const { generateKey } = require('./license')

const machineId = process.argv[2]
if (!machineId) {
  console.log('Usage: node keygen.js <MACHINE_ID>')
  console.log('Example: node keygen.js A1B2C3D4E5F6')
  process.exit(1)
}

const key = generateKey(machineId.toUpperCase())
console.log('\n=============================')
console.log('Machine ID:', machineId.toUpperCase())
console.log('License Key:', key)
console.log('=============================\n')