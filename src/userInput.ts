// Ref: https://github.com/microsoft/vscode-extension-samples/blob/master/quickinput-sample/src/multiStepInput.ts
import {
  QuickPickItem,
  window,
  Disposable,
  QuickInputButton,
  QuickInput,
  QuickInputButtons,
  workspace,
  ThemeIcon,
  TextDocument,
} from "vscode";
import { ExtensionState, Scope, SealSecretParameters } from "./types";
import { stat } from "fs";
import { extname } from "path";
import { exec } from "child_process";
import { safeLoad } from "js-yaml";

export async function collectSealSecretUserInput(
  document: TextDocument,
  extensionState: ExtensionState
): Promise<SealSecretParameters> {
  class SimpleButton implements QuickInputButton {
    constructor(public iconPath: ThemeIcon, public tooltip: string) {}
  }

  // Theme icons: https://microsoft.github.io/vscode-codicons/dist/codicon.html
  const pickCertificateFromWorkspaceButton = new SimpleButton(
    new ThemeIcon("root-folder-opened"),
    "Pick certificate from workspace"
  );

  const browseForCertificateButton = new SimpleButton(new ThemeIcon("folder-opened"), "Browse for certificate");

  const scopes: QuickPickItem[] = [Scope.strict, Scope.namespaceWide, Scope.clusterWide].map((scope) => ({
    label: Scope[scope],
  }));
  // Object.keys(Scope).map(label => ({ label }));

  interface State {
    title: string;
    step: number;
    totalSteps: number;
    scope: QuickPickItem;
    scopeValue?: Scope;
    name: string;
    namespace: QuickPickItem;
    certificatePath: string;
  }

  async function collectInputs() {
    const state = {} as Partial<State>;
    state.name = extensionState.sealSecretParams?.name;
    state.certificatePath = extensionState.sealSecretParams?.certificatePath;
    if (extensionState.sealSecretParams?.scope) {
      state.scopeValue = extensionState.sealSecretParams?.scope;
      state.scope = scopes[extensionState.sealSecretParams?.scope];
    }

    await MultiStepInput.run((input) => pickScope(input, state));
    return state as State;
  }

  const title = "Seal Secret";

  async function pickScope(input: MultiStepInput, state: Partial<State>) {
    if (extensionState.sealSecretParams?.scope) {
      state.scope = scopes[extensionState.sealSecretParams.scope];
    } else {
      state.scope = await input.showQuickPick({
        title,
        placeholder: "Select scope",
        items: scopes,
        activeItem: state.scope,
        shouldResume: shouldResume,
      });
    }
    switch (state.scope.label) {
      case Scope[Scope.strict]:
        state.scopeValue = Scope.strict;
        return (input: MultiStepInput) => inputName(input, state);
      case Scope[Scope.namespaceWide]:
        state.scopeValue = Scope.namespaceWide;
        return (input: MultiStepInput) => inputNamespace(input, state);
      case Scope[Scope.clusterWide]:
        state.scopeValue = Scope.clusterWide;
        if (extensionState.localCert) {
          return (input: MultiStepInput) => inputCertificatePath(input, state);
        }
    }
  }

  async function inputName(input: MultiStepInput, state: Partial<State>) {
    if (extensionState.sealSecretParams?.name) {
      state.name = extensionState.sealSecretParams.name;
    } else {
      state.name = await input.showInputBox({
        title,
        value: state.name || "",
        prompt: "Specify name",
        validate: validateName,
        shouldResume: shouldResume,
      });
    }
    return (input: MultiStepInput) => inputNamespace(input, state);
  }

  async function getNamespaces() {
    const command = `${extensionState.ocPath} projects -q`;
    return new Promise<string>((resolve, reject) => {
      exec(command, {}, (error, stdout) => {
        if (error) {
          reject(error.message);
        } else {
          resolve(stdout);
        }
      });
    });
  }

  async function inputNamespace(input: MultiStepInput, state: Partial<State>) {
    const documentText = document.getText();
    const documentDom: any = safeLoad(documentText);
    const namespace = documentDom?.metadata?.namespace;
    if (namespace) {
      state.namespace = namespace;
    } else {
      const namespaces = await getNamespaces();
      const items: QuickPickItem[] = namespaces.split("\n").map((ns) => ({
        label: ns,
      }));
      state.namespace = await input.showQuickPick({
        title,
        placeholder: "Specify namespace",
        items: items,
        activeItem: state.namespace,
        validate: validateNamespace,
        shouldResume: shouldResume,
      });
    }
    if (extensionState.localCert) {
      return (input: MultiStepInput) => inputCertificatePath(input, state);
    }
  }

  async function inputCertificatePath(input: MultiStepInput, state: Partial<State>): Promise<InputStep | void> {
    let pick = await input.showInputBox({
      title,
      value: state.certificatePath || "",
      prompt: "Specify certificate path",
      buttons: [pickCertificateFromWorkspaceButton, browseForCertificateButton],
      validate: validateCertificatePath,
      shouldResume: shouldResume,
    });

    if (pick instanceof SimpleButton) {
      if (pick === pickCertificateFromWorkspaceButton) {
        let files = await workspace.findFiles("**/*.pem");
        if (files.length > 0) {
          let items = files.map((x) => ({ label: x.path.replace(/^\/([A-Za-z]{1,2}:)/, "$1") })); // getting rid of initial slash since we get /c:/some-path
          let pick = await input.showQuickPick({
            title,
            placeholder: "Select certificate",
            items: items,
            activeItem: state.scope,
            shouldResume: shouldResume,
          });

          state.certificatePath = pick.label;
        } else {
          window.showInformationMessage("No certificates found in the current workspace");
          return (input: MultiStepInput) => inputCertificatePath(input, state);
        }
      } else if (pick === browseForCertificateButton) {
        const browseResult = await window.showOpenDialog({
          canSelectFiles: true,
          canSelectFolders: false,
          canSelectMany: false,
          // eslint-disable-next-line @typescript-eslint/naming-convention
          filters: { Certificates: ["pem"] },
        });

        if (browseResult && browseResult.length > 0) {
          state.certificatePath = browseResult[0].fsPath;
        }

        return (input: MultiStepInput) => inputCertificatePath(input, state);
      }
    } else {
      state.certificatePath = pick;
    }
  }

  function shouldResume() {
    // Could show a notification with the option to resume.
    return new Promise<boolean>((resolve, reject) => {});
  }

  async function validateName(name: string) {
    if (!name) {
      return "Please specify name";
    }
  }

  async function validateNamespace(namespace: string) {
    if (!namespace) {
      return "Please specify namespace";
    }
  }

  async function validateCertificatePath(certificatePath: string) {
    if (extname(certificatePath) !== ".pem") {
      return "Invalid certificate filename";
    }

    const fileExists = await new Promise((resolve) => stat(certificatePath, resolve));
    if (!fileExists) {
      return "File not found";
    }
  }

  const state = await collectInputs();
  return {
    scope: state.scopeValue,
    name: state.name,
    namespace: state.namespace.label,
    certificatePath: state.certificatePath,
  };
}

// -------------------------------------------------------
// Helper code that wraps the API for the multi-step case.
// -------------------------------------------------------

class InputFlowAction {
  private constructor() {}
  static back = new InputFlowAction();
  static cancel = new InputFlowAction();
  static resume = new InputFlowAction();
}

type InputStep = (input: MultiStepInput) => Thenable<InputStep | void>;

interface QuickPickParameters<T extends QuickPickItem> {
  title: string;
  step?: number;
  totalSteps?: number;
  items: T[];
  activeItem?: T;
  placeholder: string;
  buttons?: QuickInputButton[];
  shouldResume: () => Thenable<boolean>;
}

interface InputBoxParameters {
  title: string;
  step?: number;
  totalSteps?: number;
  value: string;
  prompt: string;
  validate: (value: string) => Promise<string | undefined>;
  buttons?: QuickInputButton[];
  shouldResume: () => Thenable<boolean>;
}

class MultiStepInput {
  static async run<T>(start: InputStep) {
    const input = new MultiStepInput();
    return input.stepThrough(start);
  }

  private current?: QuickInput;
  private steps: InputStep[] = [];

  private async stepThrough<T>(start: InputStep) {
    let step: InputStep | void = start;
    while (step) {
      this.steps.push(step);
      if (this.current) {
        this.current.enabled = false;
        this.current.busy = true;
      }
      try {
        step = await step(this);
      } catch (err) {
        if (err === InputFlowAction.back) {
          this.steps.pop();
          step = this.steps.pop();
        } else if (err === InputFlowAction.resume) {
          step = this.steps.pop();
        } else if (err === InputFlowAction.cancel) {
          step = undefined;
        } else {
          throw err;
        }
      }
    }
    if (this.current) {
      this.current.dispose();
    }
  }

  async showQuickPick<T extends QuickPickItem, P extends QuickPickParameters<T>>({
    title,
    step,
    totalSteps,
    items,
    activeItem,
    placeholder,
    buttons,
    shouldResume,
  }: P) {
    const disposables: Disposable[] = [];
    try {
      return await new Promise<T | (P extends { buttons: (infer I)[] } ? I : never)>((resolve, reject) => {
        const input = window.createQuickPick<T>();
        input.title = title;
        input.step = step;
        input.totalSteps = totalSteps;
        input.placeholder = placeholder;
        input.items = items;
        if (activeItem) {
          input.activeItems = [activeItem];
        }
        input.buttons = [...(this.steps.length > 1 ? [QuickInputButtons.Back] : []), ...(buttons || [])];
        disposables.push(
          input.onDidTriggerButton((item) => {
            if (item === QuickInputButtons.Back) {
              reject(InputFlowAction.back);
            } else {
              resolve(<any>item);
            }
          }),
          input.onDidChangeSelection((items) => resolve(items[0])),
          input.onDidHide(() => {
            (async () => {
              reject(shouldResume && (await shouldResume()) ? InputFlowAction.resume : InputFlowAction.cancel);
            })().catch(reject);
          })
        );
        if (this.current) {
          this.current.dispose();
        }
        this.current = input;
        this.current.show();
      });
    } finally {
      disposables.forEach((d) => {
        if (d && typeof d.dispose === "function") {
          d.dispose();
        }
      });
    }
  }

  async showInputBox<P extends InputBoxParameters>({
    title,
    step,
    totalSteps,
    value,
    prompt,
    validate,
    buttons,
    shouldResume,
  }: P) {
    const disposables: Disposable[] = [];
    try {
      return await new Promise<string | (P extends { buttons: (infer I)[] } ? I : never)>((resolve, reject) => {
        const input = window.createInputBox();
        input.title = title;
        input.step = step;
        input.totalSteps = totalSteps;
        input.value = value || "";
        input.prompt = prompt;
        input.buttons = [...(this.steps.length > 1 ? [QuickInputButtons.Back] : []), ...(buttons || [])];
        let validating = validate("");
        disposables.push(
          input.onDidTriggerButton((item) => {
            if (item === QuickInputButtons.Back) {
              reject(InputFlowAction.back);
            } else {
              resolve(<any>item);
            }
          }),
          input.onDidAccept(async () => {
            const value = input.value;
            input.enabled = false;
            input.busy = true;
            if (!(await validate(value))) {
              resolve(value);
            }
            input.enabled = true;
            input.busy = false;
          }),
          input.onDidChangeValue(async (text) => {
            const current = validate(text);
            validating = current;
            const validationMessage = await current;
            if (current === validating) {
              input.validationMessage = validationMessage;
            }
          }),
          input.onDidHide(() => {
            (async () => {
              reject(shouldResume && (await shouldResume()) ? InputFlowAction.resume : InputFlowAction.cancel);
            })().catch(reject);
          })
        );
        if (this.current) {
          this.current.dispose();
        }
        this.current = input;
        this.current.show();
      });
    } finally {
      disposables.forEach((d) => {
        if (d && typeof d.dispose === "function") {
          d.dispose();
        }
      });
    }
  }
}
