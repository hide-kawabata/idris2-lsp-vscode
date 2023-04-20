import { spawn } from 'child_process';
import {
  workspace,
  ExtensionContext,
  window,
  OutputChannel,
  commands,
  TextEditorEdit,
  TextEditor,
  MarkdownString,
  DecorationRangeBehavior,
} from 'vscode';

import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  StreamInfo,
} from 'vscode-languageclient/node';

import { Readable } from 'stream';

const baseName = 'Idris 2 LSP';

export function activate(context: ExtensionContext) {
  const extensionConfig = workspace.getConfiguration("idris2-lsp");
  const command: string = extensionConfig.get("path") || "";
  const debugChannel = window.createOutputChannel(baseName + ' Server');
  const serverOptions: ServerOptions = () => new Promise<StreamInfo>((resolve, reject) => {
    const serverProcess = spawn(command, [], { cwd: rootPath() });
    if (!serverProcess || !serverProcess.pid) {
      return reject(`Launching server using command ${command} failed.`);
    }

    context.subscriptions.push({
      dispose: () => {
        sendExitCommandTo(serverProcess.stdin);
      }
    });

    const stderr = serverProcess.stderr;
    stderr.setEncoding('utf-8');
    stderr.on('data', data => debugChannel.append(data));

    resolve({
      writer: serverProcess.stdin,
      reader: sanitized(serverProcess.stdout, debugChannel),
      detached: true // let us handle the disposal of the server
    });
  });
  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: 'file', language: 'idris' },
      { scheme: 'file', language: 'lidr' }
    ],
  };
  const client = new LanguageClient(
    'idris2-lsp',
    baseName + ' Client',
    serverOptions,
    clientOptions
  );
  client.start();
  context.subscriptions.push({
    dispose: () => {
      client.stop();
    }
  });
  registerCommandHandlersFor(client, context);
}

function parse_selection(code: string, ch: number): number[]{

  const flag = code.split(' ');

  var res = new Array(flag.length);
  var sum = 0;
  for(var b = 0; b < flag.length; b++) {
    res[b] = 0;
  }

  for(var i = 0; i < flag.length; i++) {
    res[i] = sum + ch;
    sum = sum + flag[i].length + 1;
  }

  return res
};

function registerCommandHandlersFor(client: LanguageClient, context: ExtensionContext) {
  const replDecorationType = window.createTextEditorDecorationType({
//    border: '2px inset darkgray',
    border: '10px inset blue',
//    borderRadius: '5px',
    borderRadius: '50px',
    after: {
//      color: 'darkgray',
      color: 'read',
    },
    rangeBehavior: DecorationRangeBehavior.ClosedClosed
  });
  context.subscriptions.push(
    commands.registerTextEditorCommand(
      'idris2-lsp.repl.eval',
      (editor: TextEditor, _edit: TextEditorEdit, customCode) => {
        const code: string = customCode || editor.document.getText(editor.selection);
        if (code.length == 0) {
          // clear decorations
          editor.setDecorations(replDecorationType, []);
          return;
        }
        client
          .sendRequest("workspace/executeCommand", { command: "repl", arguments: [code] })
          .then(
            (res) => {
              const code = res as string;
              return {
                hover: new MarkdownString().appendCodeblock(code, 'idris'),
//                preview: code
                preview: code + '<<<<<<<<<'
              };
            },
            (e) => {
              const error = `${e}`;
              return {
                hover: new MarkdownString().appendText(error),
                preview: error
              };
            }
          )
          .then((res) => {
            console.log(`>${res.preview}<`);
            editor.setDecorations(
              replDecorationType,
              [{
                range: editor.selection,
                hoverMessage: res.hover,
                renderOptions: {
                  after: {
//                    contentText: ' => ' + inlineReplPreviewFor(res.preview) + ' ',
                    contentText: ' ======> ' + inlineReplPreviewFor(res.preview) + ' ',
                  },
                }
              }]
            );
          });
      }
    )
  );
  context.subscriptions.push(
    commands.registerTextEditorCommand(
      'idris2-lsp.repl.minamiyama',
      (editor: TextEditor, _edit: TextEditorEdit, customCode) => {
        const code: string = customCode || editor.document.getText(editor.selection);
        const uri = editor.document.uri.fsPath;
        const pos = editor.selection.start;
        const ln = pos.line;
        const ch = pos.character;
        const tops: number[] = parse_selection(code, ch);
        var types: string[] = [];
        if (code.length == 0) {
          editor.setDecorations(replDecorationType, []);
          return;
        }

        const f = (tops: number[], i: number, max: number) => {
          if (i < max) {
            client
            .sendRequest('textDocument/hover', {textDocument: {uri: "file://" + uri}, position: {line: ln, character: tops[i]}})
            .then((my_res: any) => {
              types.push(String(my_res.contents.value.split("\n")[1].trim()));
              f(tops, i+1, max);
            })
          } else {
            var res = "";
            var res2 = "";
            var spawn = require('child_process').spawn;
            var prc = spawn('/Users/kawabata/MNMYM/20230105/echo', types); // external command
            prc.stdout.setEncoding('utf8');
            prc.stdout.on('data', function (data) {
              var str = data.toString();
              res = str;
              res2 = str;
            });
            prc.on('close', function (code) {
              editor.setDecorations(
                replDecorationType, [{
                  range: editor.selection,
                  hoverMessage: res,
                  renderOptions: { // for debuggin
                    after: { contentText: ` ===> res = ${res2.replace(/\n/g, ', ')}, types = ${types} ` }
                  }
                }]
              )
            });
          }
        };
        f(tops, 0, tops.length);


/*
//        for (var i = 0; i < tops.length; i++) {
          client
          .sendRequest('textDocument/hover', {textDocument: {uri: "file://" + uri},
                                              position: {line: ln, character: tops[0]}})
          .then(
            (my_res: any) => {
              types.push(String(my_res.contents.value.split("\n")[1].trim()));
              client
              .sendRequest('textDocument/hover', {textDocument: {uri: "file://" + uri},
                                                  position: {line: ln, character: tops[1]}})
              .then(
                (my_res: any) => {
                  types.push(String(my_res.contents.value.split("\n")[1].trim()));
                  client
                  .sendRequest('textDocument/hover', {textDocument: {uri: "file://" + uri},
                                                      position: {line: ln, character: tops[2]}})
                  .then(
                    (my_res: any) => {
                      types.push(String(my_res.contents.value.split("\n")[1].trim()));

                      editor.setDecorations(
                        replDecorationType, [{
                          range: editor.selection,
                          hoverMessage: `${types}`,
                          renderOptions: {
                            after: {
                                contentText: ` ======> typs = ${types}, tops.length = ${tops.length}, laststr = ${laststr} `,
                            },
                          }
                        }]
                      )      
                    }
                  )
                }
              );
            }
          );
*/
/*
          editor.setDecorations(
          replDecorationType, [{
            range: editor.selection,
            hoverMessage: `${types.length}`,
//            hoverMessage: `${tops.length}`,
//            hoverMessage: "hello",
            renderOptions: {
              after: {
                  contentText: ` ======> typs = ${types}, tops.length = ${tops.length}, laststr = ${laststr} `,
              },
            }
          }]
        )
*/
      }
    )
  );
  context.subscriptions.push(
    commands.registerTextEditorCommand(
      'idris2-lsp.repl.eval2',
      (editor: TextEditor, _edit: TextEditorEdit, customCode) => {
        const code: string = customCode || editor.document.getText(editor.selection);
        const uri = editor.document.uri.fsPath;
        const pos = editor.selection.start;
        const ln = pos.line;
        const ch = pos.character;
        const tops: number[] = parse_selection(code, ch);
        var types: string[] = [];
        //        const pos = editor.document.positionAt(100);
        if (code.length == 0) {
          // clear decorations
          editor.setDecorations(replDecorationType, []);
          return;
        }
/*
        poss: int[] = parse_selection(code, pos) // セレクション内の単語の位置を調べる
        foreach (...poss... ) {
           res = client.sendRequest(...); // LSP への問い合わせ
           tys.append(res.value); // LSP から得られた型情報を集める
        }
        const tys2: string = mnmym_special(code, tys);
        return {
          hover: new MarkdownString().appendCodeblock(tys2, 'idris2'),
          preview: tys2
        };
      }
    )
  )
*/
        client
//          .sendRequest("workspace/executeCommand", { command: "repl", arguments: [code] })
//          .sendRequest("workspace/executeCommand", { command: "repl", arguments: [":t " + code] })
//          .sendRequest("textDocument/hover", { command: "hover", arguments: pos})
//          .sendRequest("textDocument/hover", { textDocument: { uri : "file://" + uri }, position: { line: 23, character: 16}})
          .sendRequest("textDocument/hover", { textDocument: { uri : "file://" + uri }, position: { line: ln, character: ch}})
          .then(
            (res: any) => {
              const code0 = (res.contents.value) as string;
              const code = code0.split("\n")[1].trim();
              return {
                hover: new MarkdownString().appendCodeblock(code, 'idris'),
                preview: code + '<<<<<<<<<<<<<<<<<<<<<<<<<<<'
              };
            },
            (e) => {
              const error = `${e}`;
              return {
                hover: new MarkdownString().appendText(error),
                preview: error
              };
            }
          )
          .then((res) => {
            console.log(`>${res.preview}<`);
            editor.setDecorations(
              replDecorationType,
              [{
                range: editor.selection,
//                hoverMessage: "(((" + res.hover + ")))",
//                hoverMessage: "(((" + inlineReplPreviewFor(res.preview) + ")))",
                hoverMessage: "(((" + res.hover.value + ")))",
                renderOptions: {
                  after: {
                      contentText: ` ==========================> ${res.preview} `,
                  },
                }
              }]
            );
          });
      }
    )
  );
}

function inlineReplPreviewFor(res: string) {
  const maxPreviewLength = 80;
  const lines = res.split(/\r?\n/, 2);
  const firstLine = lines[0];
  const ellipsis = '…';
  if (lines.length > 1) {
    if (lines.length < maxPreviewLength) {
      return firstLine.substring(0, maxPreviewLength);
    }
    return firstLine.substring(0, maxPreviewLength) + ellipsis;
  }
  return firstLine.length > maxPreviewLength
    ? firstLine.substring(0, maxPreviewLength) + ellipsis
    : firstLine;
}

function sendExitCommandTo(server: NodeJS.WritableStream) {
  const command = '{"jsonrpc":"2.0","method":"exit"}';
  server.write(`Content-Length: ${command.length}\r\n\r\n`);
  server.write(command);
}

/**
 * Returns a new stream with spurious content removed, anything between proper
 * [LSP messages](https://microsoft.github.io/language-server-protocol/specifications/specification-3-14/)
 * is discarded.
 * 
 * This is necessary because the Idris 2 core writes error messages directly to stdout.
 *
 * @param source idris2-lsp stdout
 */
function sanitized(source: Readable, debugChannel: OutputChannel): NodeJS.ReadableStream {
  return Readable.from(sanitize(source, debugChannel));
}

async function* sanitize(source: Readable, debugChannel: OutputChannel) {

  let waitingFor = 0;
  let chunks = [];

  for await (const chunk of source) {
    if (waitingFor > 0) {
      // We are already reading a message
      if (chunk.length > waitingFor) {
        const remaining = chunk.subarray(waitingFor);
        chunks.push(remaining);

        const awaited = chunk.subarray(0, waitingFor);
        waitingFor = 0;
        yield awaited;
      }

      waitingFor -= chunk.length;

      yield chunk;
      continue;
    }

    chunks.push(chunk);

    while (chunks.length > 0) {
      const pending = Buffer.concat(chunks);
      const header = findHeader(pending);
      if (header) {
        if (header.begin > 0) {
          debugDiscarded(pending.subarray(0, header.begin));
        }
        const contentLength = header.contentLength;
        const contentEnd = header.end + contentLength;
        const newChunk = pending.subarray(header.begin, contentEnd);
        const headerLength = header.end - header.begin;
        waitingFor = headerLength + contentLength - newChunk.length;
        chunks = waitingFor > 0 ? [] : [pending.subarray(contentEnd)];
        yield newChunk;
      } else {
        // Reuse concat result
        chunks = [pending];
        break;
      }
    }
  }

  function debugDiscarded(discarded: Buffer) {
    debugChannel.appendLine("> STDOUT");
    debugChannel.append(discarded.toString('utf-8'));
    debugChannel.appendLine("< STDOUT");
  }
}

interface ContentHeader {
  begin: number,
  end: number,
  contentLength: number
}

function findHeader(buffer: Buffer): undefined | ContentHeader {
  // Search the buffer for the pattern `Content-Length: \d+\r\n\r\n`
  let searchIndex = 0;
  while (searchIndex < buffer.length) {
    const headerPattern = 'Content-Length: ';
    const separatorPattern = '\r\n\r\n';
    const begin = buffer.indexOf(headerPattern, searchIndex);
    if (begin < 0) {
      break;
    }
    const lengthBegin = begin + headerPattern.length;
    const separatorIndex = buffer.indexOf(separatorPattern, lengthBegin);
    if (separatorIndex > lengthBegin) {
      const lengthBuffer = buffer.subarray(lengthBegin, separatorIndex);
      if (lengthBuffer.every((value, _index, _array) => isDigit(value))) {
        const contentLength = Number.parseInt(lengthBuffer.toString('utf-8'));
        const end = separatorIndex + separatorPattern.length;
        return { begin, end, contentLength };
      }
    }
    searchIndex = lengthBegin;
  }
  return undefined;
}

function isDigit(value: number): boolean {
  return value >= zero && value <= nine;
}

const zero = '0'.charCodeAt(0);

const nine = '9'.charCodeAt(0);

function rootPath(): string | undefined {
  const folders = workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return undefined;
  }
  const folder = folders[0];
  if (folder.uri.scheme === 'file') {
    return folder.uri.fsPath;
  }
  return undefined;
}
