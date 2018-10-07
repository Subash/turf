import fs from 'fs-extra';
import path from 'path';

class Compiler {
  static COMMENT_START = '<!--';
  static COMMENT_END = '-->';
  static NEW_LINE = '\n';
  static extensions = [ '.kit', '.turf' ];

  constructor(options) {
    this.variables = options.variables || {};
    this.data = options.data || '';
    this.file = options.file || '';
    this.rootDir = options.rootDir || path.dirname(this.file);
    this.baseDir = path.dirname(this.file);
    this.parents = options.parents || [];
  }

  findPosition({ data, keyword, startPosition, endPosition }) {
    if(!Number.isInteger(endPosition)) endPosition = data.length;
    data = data.substring(0, endPosition);
    let keywordPosition = data.indexOf(keyword, startPosition);
    if(keywordPosition === -1) return;
    return {
      start: keywordPosition,
      end:  keywordPosition + keyword.length //string.indexOf() returns the start position of the keyword so add the length of the keyword to find the end position
    }
  }

  /**
   * Split data into blocks of data and comments
   */
  findBlocks(data) {
    let startPosition = 0; // Start from the beginning of the string
    let blocks = [];
  
    while(startPosition < data.length) {
      const commentStart = this.findPosition({ data, keyword: Compiler.COMMENT_START, startPosition });

      //If there are no comments
      if(!commentStart) {
        let newLine = this.findPosition({ data, keyword: Compiler.NEW_LINE, startPosition });
        //If there is a new line keep the data until the new line and move on otherwise keep the rest of the data
        const endPosition = newLine ? newLine.end: data.length;
        blocks.push({ start: startPosition, end: endPosition, data: data.substring(startPosition, endPosition) });
        startPosition = endPosition;
        continue;
      }
      
      let commentEnd = this.findPosition({ data, keyword: Compiler.COMMENT_END, startPosition: commentStart.end });
      //Comments must have an end
      if(!commentEnd) {
        const err = new Error('Invalid comment. Comment not closed.');
        const { line, column } = this.getLineColumnFromPosition(data, commentStart.start);
        err.file = this.file;
        err.line = line;
        err.column = column;
        throw err;
      }

      //Check if there is any new line before the comment
      let newLine = this.findPosition({ data, keyword: Compiler.NEW_LINE, startPosition: startPosition, endPosition: commentStart.start });
      //if there is a new line before the comment keep the data until the new line and continue to the next line
      if(newLine) {
        blocks.push({ start: startPosition, end: newLine.end, data: data.substring(startPosition, newLine.end) });
        startPosition = newLine.end;
        continue;
      }

      //Keep the data before the comment block
      blocks.push({ start: startPosition, end: commentStart.start, data: data.substring(startPosition, commentStart.start) });
      //Keep the data inside the comment block
      blocks.push({ start: commentStart.start, end: commentEnd.end, data: data.substring(commentStart.start, commentEnd.end) });

      //Move on to the end of the comment
      startPosition = commentEnd.end;
    }
  
    return blocks;
  }

  isComment(string) {
    return string.startsWith(Compiler.COMMENT_START);
  }
  
  getCommentContent(comment) {
    return comment.substring(Compiler.COMMENT_START.length, comment.length - Compiler.COMMENT_END.length).trim(); // Remove starting and closing whitespace
  }
  
  isSpecialComment(string) {
    if(!this.isComment(string)) return false;
    const content = this.getCommentContent(string);
    return ['@', '$'].some( keyword => content.startsWith(keyword));
  }
  
  isInclude(content) {
    return ['@include', '@import'].some( keyword => content.startsWith(keyword));
  }

  /**
   * Variables can be declared in multiple ways
   * $variable = value
   * $variable : value
   * $variable value
   * Also @ character can be used instead of the $
   */
  parseVariable(content) {
    let [ variable, ...value ] = content.split(/(\s|=|:)/);
    
    // Join the rest of the content together then remove opening/closing whitespace
    value = value.join('').trim();

    // Remove the assignment operator such as = and : from the beginning of the value
    if(['=', ':'].some( operator => value.startsWith(operator))) {
      value = value.substring(1).trim() // Take the rest of the string except the first character then remove the opening/closing whitespace
    }

    // Remove the declaration operator such as @ or $ from the variable
    variable = variable.substring(1);

    return {
      variable, value
    };
  }

  isVariableInitialization(content) {
    const { variable, value } = this.parseVariable(content);
    return !!value; // Variable is initialized when a value is set
  }
  
  isVariableUse(content) {
    return !this.isVariableInitialization(content);
  }

  setVariable(variable, value) {
    if(value === 'nil') {
      delete this.variables[variable];
    } else {
      this.variables[variable] = value;
    }
  }

  getVariable(variable) {
    let optional = variable.endsWith('?');
    if(optional) {
      // Remove the question mark if the variable is optional
      variable = variable.substring(0, variable.length - 1);
    }
    if(!(variable in this.variables) && !optional) {
      throw new Error(`Invalid variable. Use ${variable}? for optional variable`);
    }
    return this.variables[variable] || '';
  }

  /**
   * Resolve possible includes
   * eg: @import file can mean
   * file.kit, _file.kit or just file or _file
   */

  async resolvePossibleIncludes(include) {
    // Find file path
    // Search relative to file dir if the file path is relative
    // Search relative to root dir if the file path is absolute
    let file = path.resolve(this.baseDir, include);
    if(include.startsWith('/')) {
      // Remove the slash then resolve
      path.resolve(this.rootDir, include.substring(1));
    }

    // Find the file name and directory
    const dir = path.dirname(file);
    const name = path.basename(file);

    // Possible names can be file name or partial
    let names = [ name, `_${name}`];

    // Add possible extensions
    let files = [];
    for(const name of names) {
      files.push(name);
      for(const extension of Compiler.extensions) {
        files.push(`${name}${extension}`);
      }
    }
    
    // Return full paths
    return files.map( file => path.join(dir, file));
  }

  async resolveInclude(include) {
    const possiblePaths = await this.resolvePossibleIncludes(include);
    let file;

    for(const possiblePath of possiblePaths) {
      try {
        await fs.access( possiblePath, fs.constants.F_OK);
        file = possiblePath;
        break;
      } catch (err) {}
    }

    if(!file) throw new Error(`Failed to find the included file \`${include}\``);
    if(this.parents.includes(file)) {
      throw new Error(`Recursive include detected. \`${path.relative(this.rootDir, this.file)}\` is including parent file ${path.relative(this.rootDir, file)}`);
    }
    return file;
  }

  async processInclude(content) {
    // Remove everything before the first space
    // to remove @import or @include statements
    let [ statement, ...includes ] = content.split(' ');
    includes = includes.join(' '); // Join the remaining parts

    // Split the comma separated lists
    includes = includes.split(',').map( include => include.trim());

    // Remove quotes
    includes = includes.map( include => include.replace(/('|")/g, ''));

    // Resolve actual paths
    const includedPaths = [];
    for(const include of includes) {
      includedPaths.push(await this.resolveInclude(include));
    }

    // Load included content
    const includedContent = [];
    for(const includedPath of includedPaths) {
      // Also allow @import-base64
      const base64 = statement.includes('base64');
      includedContent.push(await this.includeFile(includedPath, { base64 }));
    }

    // Join and return included content
    return includedContent.join('\n');
  }

  async includeFile(file, { base64 = false } = {}) {
    const data = await fs.readFile(file);

    //Return the base64 encoded string for @import-base64
    if(base64) return data.toString('base64');
    
    // Do not process files with different extensions
    if(!Compiler.extensions.includes(path.extname(file))) return data.toString('utf-8');

    const fileOptions = {
      variables: Object.assign({}, this.variables),
      data: data.toString('utf-8'),
      file: file,
      rootDir: this.rootDir,
      parents: [ ...this.parents, file ]
    };

    return await new Compiler(fileOptions).compile();
  }

  async processComment(comment) {
    const content = this.getCommentContent(comment);
    if(this.isInclude(content)) {
      return await this.processInclude(content);
    } else if(this.isVariableInitialization(content)) {
      const { variable, value } = this.parseVariable(content);
      this.setVariable(variable, value);
    } else if(this.isVariableUse(content)) {
      const { variable } = this.parseVariable(content);
      return this.getVariable(variable);
    } else {
      return comment;
    }
  }

  getLineColumnFromPosition(data, position) {
    const lines = data.substring(0, position).split('\n');
    const line = lines.length;
    const lineContent = lines[lines.length - 1];
    const column = lineContent.length + 1;
    return { line, column };
  }

  async compile() {
    const blocks = this.findBlocks(this.data);
    const chunks = [];
    for(const [index, block] of blocks.entries()) {
      // If data on this block is empty; 
      // check if previous or next block is a variable declaration and remove it to remove the whitespace around variable declarations
      if(!block.data.trim()) {
        const previousBlock = blocks[index-1];
        if(previousBlock && this.isSpecialComment(previousBlock.data)) {
          const content = this.getCommentContent(previousBlock.data);
          if(this.isVariableInitialization(content)) continue;
        }

        const nextBlock = blocks[index+1];
        if(nextBlock && this.isSpecialComment(nextBlock.data)) {
          const content = this.getCommentContent(nextBlock.data);
          if(this.isVariableInitialization(content)) continue;
        }
      }

      if(this.isSpecialComment(block.data)) {
        try {
          const result = await this.processComment(block.data);
          if(result) chunks.push(result);
        } catch (err) {
          const newError = new Error(err.message);
          const lineCol = this.getLineColumnFromPosition(this.data, block.start);
          newError.file = err.file || this.file;
          newError.line = err.line || lineCol.line;
          newError.column = err.column || lineCol.column;
          newError.originalError = err;
          throw newError;
        }
      } else {
        chunks.push(block.data);
      }
    }
    return chunks.join('');
  }
}

export default async function compile(data, options = {}) {
  return await new Compiler({ data, ...options }).compile();
}
