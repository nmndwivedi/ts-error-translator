import { getTipsFromFile, Tip, tipInfo } from '@total-typescript/tips-parser';
import * as vscode from 'vscode';
import { defaultOptions } from './defaultOptions';
import { initDiagnostics } from './initDiagnostics';

const languages = [
  'typescript',
  'typescriptreact',
  'javascript',
  'javascriptreact',
];

let options = defaultOptions;

const updateOptions = () => {
  options = {
    ...defaultOptions,
    ...vscode.workspace.getConfiguration('totalTypeScript'),
  };
};

const tips = Object.keys(tipInfo);

export const getRangeFromSourceLocation = (location: {
  start: {
    line: number;
    column: number;
  };
  end: {
    line: number;
    column: number;
  };
}): vscode.Range => {
  return new vscode.Range(
    new vscode.Position(location.start.line - 1, location.start.column),
    new vscode.Position(location.end.line - 1, location.end.column),
  );
};

export async function activate(context: vscode.ExtensionContext) {
  updateOptions();
  initDiagnostics(context);

  let ignoredTips = new Set<string>(options.hiddenTips);

  const isTipComplete = (tipType: Tip['type']) => {
    const tipInfoItem = tipInfo[tipType as keyof typeof tipInfo];

    if (!tipInfoItem) {
      return true;
    }

    if (tipInfoItem.difficulty === 'easy' && options.hideBasicTips) {
      return true;
    }

    return ignoredTips.has(tipType);
  };

  const updateHiddenTips = () => {
    updateOptions();
    ignoredTips = new Set(options.hiddenTips);
  };

  if (options.hideBasicTips === null) {
    vscode.window
      .showInformationMessage(
        `Would you call yourself a TypeScript beginner? If you are, we'll show you tips that are helpful when you're first learning TypeScript.`,
        'Yes',
        'No',
      )
      .then((res) => {
        if (!res) {
          return;
        }
        vscode.workspace
          .getConfiguration('totalTypeScript')
          .update(
            'hideBasicTips',
            res === 'No',
            vscode.ConfigurationTarget.Global,
          );
      });
  }

  const helperDiagnostics =
    vscode.languages.createDiagnosticCollection('helpers');
  const uriStore: Record<string, Array<Tip & { range: vscode.Range }>> = {};

  tips.forEach((tip) => {
    context.subscriptions.push(
      vscode.commands.registerCommand(
        `ts-error-translator.dont-show-again.${tip}`,
        async () => {
          const humanReadableTip: string | undefined =
            tipInfo[tip as keyof typeof tipInfo]?.name;

          if (!humanReadableTip) {
            return;
          }

          const config = vscode.workspace.getConfiguration('totalTypeScript');

          ignoredTips.add(tip);

          await config.update(
            'hiddenTips',
            Array.from(ignoredTips),
            vscode.ConfigurationTarget.Global,
          );

          if (vscode.window.activeTextEditor?.document) {
            updateDiagnostics(vscode.window.activeTextEditor.document);
          }
        },
      ),
    );
  });

  const updateDiagnostics = async (document: vscode.TextDocument) => {
    try {
      const tipsFromFile = getTipsFromFile(document.getText());

      const tipHasNoDepsOrAllDepsCompleted = (tip: Tip) => {
        const tipInfoItem = tipInfo[tip.type];

        if (!tipInfoItem) {
          return false;
        }

        // Tip has no deps
        if (!tipInfoItem.deps) {
          return true;
        }

        const deps = Array.isArray(tipInfoItem.deps)
          ? tipInfoItem.deps
          : [tipInfoItem.deps];

        return deps.every((dep) => {
          return isTipComplete(dep);
        });
      };

      /**
       * Tips where the deps have been fulfilled
       */
      const tipsWithoutDeps = tipsFromFile.filter(
        tipHasNoDepsOrAllDepsCompleted,
      );

      uriStore[document.uri.path] = tipsWithoutDeps
        .filter((tip) => !isTipComplete(tip.type))
        .map((tip) => ({
          ...tip,
          range: getRangeFromSourceLocation(tip.loc),
        }));
    } catch (e) {}

    helperDiagnostics.set(
      document.uri,
      uriStore[document.uri.path].map((tip) => {
        const diagnostic = new vscode.Diagnostic(
          tip.range,
          tip.type,
          vscode.DiagnosticSeverity.Information,
        );
        diagnostic.source = 'total-typescript';
        return diagnostic;
      }),
    );
  };

  if (vscode.window.activeTextEditor) {
    await updateDiagnostics(vscode.window.activeTextEditor.document);
  }

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(async (editor) => {
      if (editor) {
        await updateDiagnostics(editor.document);
      }
    }),
    vscode.workspace.onDidChangeTextDocument(async (e) => {
      await updateDiagnostics(e.document);
    }),
  );

  const hoverProvider: vscode.HoverProvider = {
    provideHover: (document, position) => {
      const itemsInUriStore = uriStore[document.uri.path];

      if (!itemsInUriStore) {
        return null;
      }

      const items = itemsInUriStore.filter((item) => {
        return item.range.contains(position);
      });

      const contents = items
        .map((itemInRange) => {
          const thisTip = tipInfo[itemInRange.type];

          if (!thisTip) {
            return '';
          }
          const mdString = new vscode.MarkdownString(
            `**${thisTip.name}**\n\n${
              thisTip.message ? `${thisTip.message}\n\n` : ''
            }${
              thisTip.link ? `[Learn More](${thisTip.link}) |` : ''
            } [Mark as Learned](command:ts-error-translator.dont-show-again.${
              itemInRange.type
            })`,
          );

          mdString.isTrusted = true;
          mdString.supportHtml = true;

          return mdString;
        })
        .filter(Boolean);

      return {
        contents,
      };
    },
  };

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (e.affectsConfiguration('totalTypeScript')) {
        updateHiddenTips();
      }

      if (vscode.window.activeTextEditor) {
        await updateDiagnostics(vscode.window.activeTextEditor.document);
      }
    }),
  );

  context.subscriptions.push(
    ...languages.map((language) => {
      return vscode.languages.registerHoverProvider(
        {
          language,
        },
        hoverProvider,
      );
    }),
  );
}

// this method is called when your extension is deactivated
export function deactivate() {}
