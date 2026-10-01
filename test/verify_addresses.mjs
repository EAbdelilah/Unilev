import { config } from 'dotenv'
import { createPublicClient, http } from 'viem'
import { unichain } from 'viem/chains'
import { getAddress } from 'viem'

config({ path: process.env.ENV_PATH ?? '.env', quiet: true })

const url = process.env.UNICHAIN_RPC_URL
const client = createPublicClient({ chain: unichain, transport: http(url, { batch: true }) })

const targets = {
  'Balancer V2 Vault': '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
  'Aave V3 Pool': '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
  'Uniswap V3 Factory': '0x1F98400000000000000000000000000000000003',
  'Uniswap V3 QuoterV2': '0x385a5cf5f83e99f7bb2852b6a19c3538b9fa7658',
  'Uniswap V2 Factory': '0x1F98400000000000000000000000000000000002',
  'Uniswap V2 Router02': '0x284f11109359a7e1306c3e447ef14d38400063ff',
  'Uniswap V4 Quoter': '0x333e3c607b141b18ff6de9f258db6e77fe7491e0',
  'Uniswap V4 StateView': '0x86e8631a016f9068c3f085faf484ee3f5fdee8f2',
  'Eswap hook': '0xdF768b7eb6A76594b21177bb0Cd55bA433D290c8',
  'Eswap router': '0xD123B24D7e6a8e8AD015523D7a32F3Ff2ca12B46',
}

console.log(`block ${await client.getBlockNumber()}\n`)
console.log('name                        | code size | selector probe')
console.log('-'.repeat(78))

for (const [name, addr] of Object.entries(targets)) {
  let size = 'n/a'
  try {
    const code = await client.getCode({ address: addr })
    size = code && code !== '0x' ? `${((code.length - 2) / 2).toLocaleString()} B` : 'NO CODE'
  } catch (e) {
    size = `err`
  }

  // Probe the specific function this project actually calls, so "has code"
  // is not mistaken for "has the interface we need".
  let probe = ''
  try {
    if (name.includes('Balancer')) {
      await client.readContract({
        address: addr,
        abi: [{ type: 'function', name: 'flashLoan', stateMutability: 'payable',
          inputs: [{name:'r',type:'address'},{name:'t',type:'address[]'},{name:'a',type:'uint256[]'},{name:'d',type:'bytes'}], outputs: [] }],
        functionName: 'flashLoan',
        args: ['0x0000000000000000000000000000000000000001', [], [], '0x'],
      })
      probe = 'flashLoan ok'
    } else if (name.includes('Aave')) {
      await client.readContract({
        address: addr,
        abi: [{ type: 'function', name: 'flashLoanSimple', stateMutability: 'payable',
          inputs: [{name:'r',type:'address'},{name:'t',type:'address[]'},{name:'a',type:'uint256[]'},
                   {name:'m',type:'uint16[]'},{name:'o',type:'address'},{name:'d',type:'bytes'},
                   {name:'rbf',type:'uint16'}], outputs: [{name:'',type:'uint256[]'}] }],
        functionName: 'flashLoanSimple',
        args: ['0x0000000000000000000000000000000000000001', [], [], [], '0x0000000000000000000000000000000000000001', '0x', 0],
      })
      probe = 'flashLoanSimple ok'
    } else if (name.includes('QuoterV2')) {
      const q = await client.readContract({
        address: addr,
        abi: [{ type: 'function', name: 'quoteExactInputSingle', stateMutability: 'nonpayable',
          inputs: [{name:'p',type:'bytes'},{name:'g',type:'uint256'},{name:'a',type:'uint256'},
                   {name:'z',type:'uint160'},{name:'r',type:'uint256'}],
          outputs: [{name:'a',type:'uint256'},{name:'b',type:'uint256'},{name:'cs',type:'uint32'},{name:'g',type:'uint256'}] }],
        functionName: 'quoteExactInputSingle',
        args: ['0x', 10000n, 1000000n, 0n, 0n],
      }).catch((e) => { throw new Error(String(e).slice(0, 60)) })
      probe = `quoteExactInputSingle ${Array.isArray(q) ? 'tuple ok' : String(q).slice(0, 20)}`
    } else if (name.includes('StateView')) {
      const sq = await client.readContract({
        address: addr,
        abi: [{ type: 'function', name: 'getSlot0', stateMutability: 'view',
          inputs: [{name:'id',type:'bytes32'}],
          outputs: [{name:'s',type:'uint160'},{name:'t',type:'int24'},{name:'p',type:'uint24'},{name:'r',type:'int24'},{name:'h',type:'uint128'}] }],
        functionName: 'getSlot0',
        args: ['0x0000000000000000000000000000000000000000000000000000000000000000'],
      })
      probe = `getSlot0 ok sqrt=${sq[0]}`
    } else if (name.includes('Quoter')) {
      probe = '(pool-key sig not probed)'
    }
  } catch (e) {
    probe = `probe err: ${String(e.message ?? e).slice(0, 70)}`
  }

  console.log(`${name.padEnd(27)} | ${size.padEnd(8)} | ${probe}`)
}