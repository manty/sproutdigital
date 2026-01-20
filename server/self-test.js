/**
 * Self-test script to verify the cloner works
 * Run with: npm test
 */

const { clonePage } = require('./cloner');
const fs = require('fs').promises;
const path = require('path');

const TEST_URL = 'https://example.com';

async function selfTest() {
  console.log('╔════════════════════════════════════════╗');
  console.log('║     Website Cloner Self-Test           ║');
  console.log('╚════════════════════════════════════════╝\n');

  const logs = [];
  const emit = (type, message) => {
    logs.push({ type, message });
    console.log(`[${type}] ${message}`);
  };

  try {
    console.log(`Testing clone of: ${TEST_URL}\n`);

    // Run clone
    const result = await clonePage(TEST_URL, emit, { headless: true });

    console.log('\n═══════════════════════════════════════');
    console.log('RESULT:', JSON.stringify(result, null, 2));
    console.log('═══════════════════════════════════════\n');

    // Verify output
    const outputDir = result.outputPath;
    const indexPath = path.join(outputDir, 'index.html');
    const assetsDir = path.join(outputDir, 'assets');

    // Check 1: Output folder exists
    const outputExists = await fs.access(outputDir).then(() => true).catch(() => false);
    console.log(`✓ Output folder exists: ${outputExists}`);
    if (!outputExists) throw new Error('Output folder not created');

    // Check 2: index.html exists
    const indexExists = await fs.access(indexPath).then(() => true).catch(() => false);
    console.log(`✓ index.html exists: ${indexExists}`);
    if (!indexExists) throw new Error('index.html not created');

    // Check 3: index.html has content
    const indexContent = await fs.readFile(indexPath, 'utf-8');
    const hasContent = indexContent.length > 100;
    console.log(`✓ index.html has content: ${hasContent} (${indexContent.length} bytes)`);
    if (!hasContent) throw new Error('index.html is empty or too small');

    // Check 4: Assets folder exists
    const assetsExists = await fs.access(assetsDir).then(() => true).catch(() => false);
    console.log(`✓ Assets folder exists: ${assetsExists}`);

    // Check 5: At least some structure
    console.log(`✓ Assets downloaded: ${result.assetsDownloaded}`);
    console.log(`✓ Assets failed: ${result.assetsFailed}`);

    console.log('\n╔════════════════════════════════════════╗');
    console.log('║     ALL TESTS PASSED!                  ║');
    console.log('╚════════════════════════════════════════╝\n');

    console.log(`Clone URL would be: ${result.openUrl}`);
    console.log(`Output path: ${result.outputPath}`);

    process.exit(0);
  } catch (error) {
    console.error('\n╔════════════════════════════════════════╗');
    console.error('║     TEST FAILED                        ║');
    console.error('╚════════════════════════════════════════╝\n');
    console.error('Error:', error.message);
    process.exit(1);
  }
}

selfTest();
