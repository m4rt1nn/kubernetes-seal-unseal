import * as vscode from "vscode";
import * as path from "path";
import { collectSealSecretUserInput } from "./userInput";
import { sealSecretRaw, sealSecretFile, unsealSecretFile } from "./seal";
import { collectSealSecretDefaults } from "./defaults";
import * as os from "os";
import * as fs from "fs";
import { ExtensionState } from "./types";
import * as yaml from "js-yaml";

let extensionState: ExtensionState = {
  kubeSealPath: undefined,
  sealSecretParams: undefined,
  localCert: true,
  controllerNamespace: undefined,
};

export function activate(context: vscode.ExtensionContext) {
  function initializeConfiguration() {
    const kubesealConfiguration = vscode.workspace.getConfiguration("kubernetes-seal-unseal");
    const configuredKubeSealPath = kubesealConfiguration.get<string>("executablePath");
    const configuredLocalCert = kubesealConfiguration.get<boolean>("useLocalCertificate");
    const configuredControllerNamespace = kubesealConfiguration.get<string>("controllerNamespace");
    extensionState.localCert = configuredLocalCert!;
    if (os.platform() === "win32") {
      extensionState.kubeSealPath = configuredKubeSealPath || path.join(context.extensionPath, "bin", "kubeseal.exe");
    } else if (configuredKubeSealPath) {
      extensionState.kubeSealPath = configuredKubeSealPath;
    } else {
      vscode.window.showErrorMessage("kubernetes-seal-unseal.executablePath not set");
    }

    if (!extensionState.kubeSealPath || !fs.existsSync(extensionState.kubeSealPath)) {
      vscode.window.showErrorMessage(
        `kubernetes-seal-unseal.executablePath is set to ${extensionState.kubeSealPath} which does not exist`
      );
    }
    extensionState.controllerNamespace = configuredControllerNamespace || "sealed-secret";
  }

  initializeConfiguration();

  const configSubscription = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("kubeseal")) {
      initializeConfiguration();
    }
  });

  context.subscriptions.push(configSubscription);

  //
  // seal secret file
  //

  let sealKubeSecretFileCommand = vscode.commands.registerCommand("extension.sealKubernetesSecretFile", async () => {
    let editor = vscode.window.activeTextEditor;

    if (editor) {
      if (editor.document.isDirty || editor.document.isUntitled) {
        await vscode.commands.executeCommand("workbench.action.files.saveAs");
      }

      if (editor.document.isDirty || editor.document.isUntitled) {
        return; // user aborted save
      }

      if (!extensionState.kubeSealPath) {
        vscode.window.showErrorMessage(`kubeseal.executablePath is not set`);
        return;
      }

      const document = editor.document;
      extensionState.sealSecretParams = collectSealSecretDefaults(document, extensionState.sealSecretParams);
      extensionState.sealSecretParams = await collectSealSecretUserInput(
        context,
        extensionState.sealSecretParams,
        extensionState.localCert
      );

      if (!extensionState.kubeSealPath) {
        vscode.window.showErrorMessage(`kubernetes-seal-unseal.executablePath is not set`);
        return;
      }

      try {
        const sealedSecret = await sealSecretFile(
          extensionState.kubeSealPath,
          document.fileName,
          extensionState.sealSecretParams,
          extensionState.localCert,
          extensionState.controllerNamespace
        );
        const textDocument = await vscode.workspace.openTextDocument({ content: sealedSecret });
        if (textDocument) {
          await vscode.window.showTextDocument(textDocument, { viewColumn: vscode.ViewColumn.Beside });
        }
      } catch (error) {
        vscode.window.showErrorMessage(String(error) || "An unknown error occurred");
      }
    }
  });
  context.subscriptions.push(sealKubeSecretFileCommand);

  let unsealKubeSecretFileCommand = vscode.commands.registerCommand(
    "extension.unsealKubernetesSecretFile",
    async () => {
      let editor = vscode.window.activeTextEditor;

      if (editor) {
        if (editor.document.isDirty || editor.document.isUntitled) {
          await vscode.commands.executeCommand("workbench.action.files.saveAs");
        }

        if (editor.document.isDirty || editor.document.isUntitled) {
          return; // user aborted save
        }
        const document = editor.document;
        try {
          const documentText = document?.getText();
          const documentDom: any = yaml.safeLoad(documentText);
          const name = documentDom?.metadata?.name;
          if (!name) {
            vscode.window.showErrorMessage("The document doesn't contain the field 'metadata.name'");
            return;
          }
          const namespace = documentDom?.metadata?.namespace;
          if (!namespace) {
            vscode.window.showErrorMessage("The document doesn't contain the field 'metadata.namespace'");
            return;
          }
          const sealedSecret = await unsealSecretFile(name, namespace, document.fileName);
          const textDocument = await vscode.workspace.openTextDocument({ content: sealedSecret });
          if (textDocument) {
            await vscode.window.showTextDocument(textDocument, { viewColumn: vscode.ViewColumn.Beside });
          }
        } catch (error) {
          vscode.window.showErrorMessage(String(error) || "An unknown error occurred");
        }
      }
    }
  );
  context.subscriptions.push(unsealKubeSecretFileCommand);

  //
  // seal secret selection
  //

  let sealKubeSecretSelectedTextCommand = vscode.commands.registerCommand(
    "extension.sealKubernetesSecretSelectedText",
    async () => {
      const editor = vscode.window.activeTextEditor;

      if (editor) {
        if (!extensionState.kubeSealPath) {
          vscode.window.showErrorMessage(`kubeseal.executablePath is not set`);
          return;
        }

        const document = editor.document;
        const selections = editor.selections;

        extensionState.sealSecretParams = collectSealSecretDefaults(document, extensionState.sealSecretParams, false);
        extensionState.sealSecretParams = await collectSealSecretUserInput(
          context,
          extensionState.sealSecretParams,
          extensionState.localCert
        );

        for (const selection of selections) {
          const plainTextSecret = document.getText(selection);

          try {
            const sealedSecret = await sealSecretRaw(
              extensionState.kubeSealPath,
              plainTextSecret,
              extensionState.sealSecretParams,
              extensionState.localCert,
              extensionState.controllerNamespace
            );

            editor.edit((editBuilder) => {
              editBuilder.replace(selection, sealedSecret);
            });
          } catch (error) {
            vscode.window.showErrorMessage(String(error) || "An unknown error occurred");
          }
        }
      }
    }
  );

  context.subscriptions.push(sealKubeSecretSelectedTextCommand);
}

export function deactivate() {}
