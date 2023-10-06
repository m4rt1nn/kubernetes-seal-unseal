import { ExtensionContext, workspace, window, commands, ViewColumn } from "vscode";
import { collectSealSecretUserInput } from "./userInput";
import { sealSecretRaw, sealSecretFile, unsealSecretFile, isLoggedOut } from "./command";
import { collectDefaults } from "./defaults";
import { existsSync } from "fs";
import { ExtensionState } from "./types";
import { safeLoad } from "js-yaml";

let extensionState: ExtensionState = {
  kubeSealPath: undefined,
  ocPath: undefined,
  sealSecretParams: undefined,
  localCert: true,
  controllerNamespace: undefined,
};

export function activate(context: ExtensionContext) {
  function initializeConfiguration() {
    const kubesealConfiguration = workspace.getConfiguration("kubernetes-seal-unseal");
    const configuredKubeSealPath = kubesealConfiguration.get<string>("executablePathKubeseal");
    const configuredOcPath = kubesealConfiguration.get<string>("executablePathOc");
    const configuredLocalCert = kubesealConfiguration.get<boolean>("useLocalCertificate");
    const configuredControllerNamespace = kubesealConfiguration.get<string>("controllerNamespace");

    extensionState.localCert = configuredLocalCert!;

    if (configuredKubeSealPath) {
      extensionState.kubeSealPath = configuredKubeSealPath;
    } else {
      window.showErrorMessage("kubernetes-seal-unseal.executableKubesealPath not set");
    }
    if (configuredOcPath) {
      extensionState.ocPath = configuredOcPath;
    } else {
      window.showErrorMessage("kubernetes-seal-unseal.executableOcPath not set");
    }

    if (!extensionState.kubeSealPath || !existsSync(extensionState.kubeSealPath)) {
      window.showErrorMessage(
        `kubernetes-seal-unseal.executableKubesealPath is set to ${extensionState.kubeSealPath} which does not exist`
      );
    }
    if (!extensionState.ocPath || !existsSync(extensionState.ocPath)) {
      window.showErrorMessage(
        `kubernetes-seal-unseal.executableOcPath is set to ${extensionState.ocPath} which does not exist`
      );
    }
    extensionState.controllerNamespace = configuredControllerNamespace || "sealed-secret";
  }

  initializeConfiguration();

  const configSubscription = workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("kubeseal")) {
      initializeConfiguration();
    }
  });

  context.subscriptions.push(configSubscription);

  //
  // seal secret file
  //

  let sealKubeSecretFileCommand = commands.registerCommand("extension.sealKubernetesSecretFile", async () => {
    if (isLoggedOut(extensionState.ocPath)) {
      window.showErrorMessage(`You need to be logged in to a cluster to run this command`);
      return;
    }

    let editor = window.activeTextEditor;

    if (editor) {
      try {
        if (editor.document.isDirty || editor.document.isUntitled) {
          await commands.executeCommand("workbench.action.files.saveAs");
        }

        if (editor.document.isDirty || editor.document.isUntitled) {
          return; // user aborted save
        }

        const document = editor.document;
        extensionState.sealSecretParams = collectDefaults(document, extensionState.sealSecretParams);
        extensionState.sealSecretParams = await collectSealSecretUserInput(document, extensionState);

        if (!extensionState.kubeSealPath) {
          window.showErrorMessage(`kubernetes-seal-unseal.executablePathKubeseal is not set`);
          return;
        }

        const sealedSecret = await sealSecretFile(
          extensionState.kubeSealPath,
          document.fileName,
          extensionState.sealSecretParams,
          extensionState.localCert,
          extensionState.controllerNamespace
        );
        const textDocument = await workspace.openTextDocument({
          content: sealedSecret.replace(/\n---.*/gm, ""),
        });
        if (textDocument) {
          await window.showTextDocument(textDocument, { viewColumn: ViewColumn.Beside });
        }
      } catch (error) {
        window.showErrorMessage(String(error) || "An unknown error occurred");
      }
    }
  });
  context.subscriptions.push(sealKubeSecretFileCommand);

  //
  // unseal secret file
  //

  let unsealKubeSecretFileCommand = commands.registerCommand("extension.unsealKubernetesSecretFile", async () => {
    if (isLoggedOut(extensionState.ocPath)) {
      window.showErrorMessage(`You need to be logged in to a cluster to run this command`);
      return;
    }

    let editor = window.activeTextEditor;

    if (editor) {
      try {
        if (editor.document.isDirty || editor.document.isUntitled) {
          await commands.executeCommand("workbench.action.files.saveAs");
        }

        if (editor.document.isDirty || editor.document.isUntitled) {
          return; // user aborted save
        }
        const document = editor.document;
        const documentText = document?.getText();
        const documentDom: any = safeLoad(documentText);
        const name = documentDom?.metadata?.name;
        if (!name) {
          window.showErrorMessage("The document doesn't contain the field 'metadata.name'");
          return;
        }
        const namespace = documentDom?.metadata?.namespace;
        if (!namespace) {
          window.showErrorMessage("The document doesn't contain the field 'metadata.namespace'");
          return;
        }

        const sealedSecret = await unsealSecretFile(`${extensionState.ocPath}`, name, namespace, document.fileName);

        const textDocument = await workspace.openTextDocument({ content: sealedSecret });
        if (textDocument) {
          await window.showTextDocument(textDocument, { viewColumn: ViewColumn.Beside });
        }
      } catch (error) {
        window.showErrorMessage(String(error) || "An unknown error occurred");
      }
    }
  });
  context.subscriptions.push(unsealKubeSecretFileCommand);

  //
  // seal secret selection
  //

  let sealKubeSecretSelectedTextCommand = commands.registerCommand(
    "extension.sealKubernetesSecretSelectedText",
    async () => {
      if (isLoggedOut(extensionState.ocPath)) {
        window.showErrorMessage(`You need to be logged in to a cluster to run this command`);
        return;
      }

      const editor = window.activeTextEditor;

      if (editor) {
        try {
          if (!extensionState.kubeSealPath) {
            window.showErrorMessage(`kubeseal.executablePath is not set`);
            return;
          }

          const document = editor.document;
          const selection = editor.selections[0];
          if (selection.isEmpty) {
            window.showErrorMessage(`You can't seal an empty selection`);
            return;
          }

          extensionState.sealSecretParams = collectDefaults(document, extensionState.sealSecretParams);
          extensionState.sealSecretParams = await collectSealSecretUserInput(document, extensionState);

          const plainTextSecret = document.getText(selection);

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
          window.showErrorMessage(String(error) || "An unknown error occurred");
        }
      }
    }
  );

  context.subscriptions.push(sealKubeSecretSelectedTextCommand);
}

export function deactivate() {}
