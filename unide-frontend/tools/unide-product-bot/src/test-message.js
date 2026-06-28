import fs from 'node:fs';
import { loadConfig, readArg } from './config.js';
import { parseProductMessage } from './templateParser.js';
import { enrichSupplierLookup, loadStoreIndex, loadSupplierIndex, lookupStore } from './supplierLookup.js';
import { formatProductResponse } from './formatResponse.js';

const config = loadConfig(readArg('--config'));
const input = fs.readFileSync(0, 'utf8');
const parsed = parseProductMessage(input);

if (!parsed.ok) {
  console.error(`Parse failed: ${parsed.error}`);
  process.exit(1);
}

const supplierIndex = loadSupplierIndex(config.supplierCsv);
const storeIndex = loadStoreIndex(config.storeCsv);
parsed.items.forEach((item, index) => {
  const store = lookupStore(storeIndex, item);
  const supplier = enrichSupplierLookup(supplierIndex, item, store);
  const desktop = { status: 'disabled' };
  console.log(formatProductResponse({
    item,
    supplier,
    store,
    desktop,
    index,
    total: parsed.items.length
  }));
  console.log('\n---\n');
});
