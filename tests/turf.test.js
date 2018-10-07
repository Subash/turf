import compile from '../lib/turf';
import fs from 'fs-extra';
import path from 'path';

async function infoFromName(fileName) {
  const input = path.resolve(__dirname, 'fixtures/input', fileName)
  const output = path.resolve(__dirname, 'fixtures/output', fileName.replace(path.extname(fileName), '.html'))
  return {
    input, output, 
    inputData: await fs.readFile(input, 'utf-8'),
    outputData: await fs.readFile(output, 'utf-8')
  };
}

test('Test Basic Compilation', async ()=> {
  const file = await infoFromName('basic.kit');
  const result = await compile(file.inputData, { file: file.input });
  expect(result).toBe(file.outputData);
});
