const compile = require('../src/turf');
const fs  = require('fs');
const path  = require('path');

async function infoFromName(fileName) {
  const input = path.resolve(__dirname, 'fixtures/input', fileName)
  const output = path.resolve(__dirname, 'fixtures/output', fileName.replace(path.extname(fileName), '.html'))
  return {
    input, output,
    inputData: await fs.promises.readFile(input, 'utf-8'),
    outputData: await fs.promises.readFile(output, 'utf-8').catch(()=> {})
  };
}

test('Test Basic Compilation', async ()=> {
  const file = await infoFromName('basic.kit');
  const result = await compile(file.inputData, { file: file.input });
  expect(result).toBe(file.outputData);
});

test('Test Basic Compilation', async ()=> {
  const file = await infoFromName('compile.kit');
  expect.assertions(2);
  try {
    await compile(file.inputData, { file: file.input });
  } catch (err) {
    expect(err.message).toContain('@compile is not supported.')
    expect(err.line).toBe(10);
  }
});
