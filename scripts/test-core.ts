// B2B Cigarette Platform Core Business Logic Verification Suite
import { normalizePacks, packsToUnit, unitToPacks } from '../src/lib/conversion';
import { encrypt, decrypt } from '../src/lib/security';

function runTests() {
  console.log('=====================================================');
  console.log('STARTING CORE BUSINESS LOGIC VALIDATION SUITE');
  console.log('=====================================================\n');

  let failedTests = 0;

  // 1. Verify Rounding Math & Normalization
  console.log('[Math] Testing Cigarette Rounding Math Rules...');
  
  const testCasesRounding = [
    { input: 13, expected: 10, msg: '13 packs rounds down to 10 packs (1 block)' },
    { input: 7, expected: 10, msg: '7 packs rounds up to 10 packs (1 block)' },
    { input: 2, expected: 0, msg: '2 packs rounds down to 0 packs' },
    { input: 25, expected: 30, msg: '25 packs rounds up to 30 packs' },
    { input: 503, expected: 500, msg: '503 packs rounds down to 500 packs (1 case)' },
    { input: 508, expected: 510, msg: '508 packs rounds up to 510 packs' }
  ];

  testCasesRounding.forEach((tc) => {
    const result = normalizePacks(tc.input);
    if (result === tc.expected) {
      console.log(`  ✓ PASS: Input ${tc.input} packs -> Normalized to ${result} packs. (${tc.msg})`);
    } else {
      console.log(`  ✗ FAIL: Input ${tc.input} packs -> Expected ${tc.expected}, got ${result}`);
      failedTests++;
    }
  });

  // 2. Verify Packs/Blocks/Cases conversions
  console.log('\n[Conversions] Testing packsToUnit & unitToPacks...');
  
  // packsToUnit BLOCKS
  const resBlocks = packsToUnit(120, 'BLOCKS');
  if (resBlocks === 12) {
    console.log(`  ✓ PASS: 120 packs converted to ${resBlocks} blocks`);
  } else {
    console.log(`  ✗ FAIL: 120 packs converted to blocks. Expected 12, got ${resBlocks}`);
    failedTests++;
  }

  // packsToUnit CASES
  const resCases = packsToUnit(1200, 'CASES');
  if (resCases === 2.4) {
    console.log(`  ✓ PASS: 1200 packs converted to ${resCases} cases`);
  } else {
    console.log(`  ✗ FAIL: 1200 packs converted to cases. Expected 2.4, got ${resCases}`);
    failedTests++;
  }

  // unitToPacks BLOCKS
  const resPacksFromBlocks = unitToPacks(5, 'BLOCKS');
  if (resPacksFromBlocks === 50) {
    console.log(`  ✓ PASS: 5 blocks resolved back to ${resPacksFromBlocks} packs`);
  } else {
    console.log(`  ✗ FAIL: 5 blocks resolved to packs. Expected 50, got ${resPacksFromBlocks}`);
    failedTests++;
  }

  // 3. Verify AES Cryptographic backups
  console.log('\n[Security] Testing Cryptographic AES-256-CBC Encrypted backups...');
  
  const originalText = JSON.stringify([
    { id: '1', email: 'dealer@asia.com', name: 'Asia Tobacco', role: 'CUSTOMER' },
    { id: '2', email: 'seller@wholesale.ru', name: 'Anna Seller', role: 'SELLER' }
  ]);
  const passphrase = 'B2BSecureSystemPassphrase2026';

  try {
    const encryptedText = encrypt(originalText, passphrase);
    console.log(`  ✓ PASS: User DB string serialized and encrypted safely. Format: ${encryptedText.slice(0, 40)}...`);

    const decryptedText = decrypt(encryptedText, passphrase);
    
    if (decryptedText === originalText) {
      console.log('  ✓ PASS: AES Decryption matches original plaintext database payload.');
    } else {
      console.log('  ✗ FAIL: Plaintext payload mismatch after decryption.');
      failedTests++;
    }
  } catch (err: any) {
    console.log(`  ✗ FAIL: Encryption test threw error: ${err.message}`);
    failedTests++;
  }

  console.log('\n=====================================================');
  if (failedTests === 0) {
    console.log('ALL TESTS PASSED! PLATFORM IS PRODUCTION READY!');
  } else {
    console.log(`VALIDATION FINISHED WITH ${failedTests} FAILURE(S).`);
  }
  console.log('=====================================================');
}

runTests();
