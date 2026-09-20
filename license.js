const crypto = require('crypto')
const os = require('os')

// This is your secret salt — CHANGE THIS to something only you know!
const SECRET_SALT = 'SaheeraShahith'

function getMachineId() {
  const hostname = os.hostname()
  const platform = os.platform()
  const cpus = os.cpus()[0]?.model || 'unknown'
  const raw = `${hostname}-${platform}-${cpus}`
  return crypto.createHash('md5').update(raw).digest('hex').substring(0, 12).toUpperCase()
}

function generateKey(machineId) {
  const raw = `${machineId}-${SECRET_SALT}`
  const hash = crypto.createHash('sha256').update(raw).digest('hex').toUpperCase()
  const part1 = hash.substring(0, 4)
  const part2 = hash.substring(4, 8)
  const part3 = hash.substring(8, 12)
  const part4 = hash.substring(12, 16)
  return `${part1}-${part2}-${part3}-${part4}`
}

function validateKey(inputKey, machineId) {
  const correctKey = generateKey(machineId)
  return inputKey.trim().toUpperCase() === correctKey
}

module.exports = { getMachineId, generateKey, validateKey }