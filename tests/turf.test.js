const compile = require('../src/turf');
const fs  = require('fs');
const path  = require('path');

async function infoFromName(fileName) {
  const input = path.resolve(__dirname, 'fixtures/input', fileName)
  const output = path.resolve(__dirname, 'fixtures/output', fileName.replace(path.extname(fileName), '.html'))
  return {
    input, output,
    inputData: await fs.promises.readFile(input, 'utf-8'),
    outputData: await fs.promises.readFile(output, 'utf-8')
  };
}

test('Test Basic Compilation', async ()=> {
  const file = await infoFromName('basic.kit');
  const result = await compile(file.inputData, { file: file.input });
  expect(result).toBe(file.outputData);
});
