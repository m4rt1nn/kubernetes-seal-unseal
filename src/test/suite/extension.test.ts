import * as assert from "assert";
import * as vscode from "vscode";
import sinon, { stubInterface } from "ts-sinon";
import { beforeEach, afterEach } from "mocha";
import * as fs from "fs";
import * as tmp from "tmp";
import * as path from "path";
import * as yaml from "js-yaml";
import { Scope } from "../../types";

function delay(timeInMilliSeconds: number) {
  return new Promise((res) => setTimeout(res, timeInMilliSeconds));
}

suite("Extension Test Suite", () => {
  let createQuickPickStub: sinon.SinonStub;
  let createInputBoxStub: sinon.SinonStub;

  beforeEach(() => {
    createQuickPickStub = sinon.stub(vscode.window, "createQuickPick");
    createInputBoxStub = sinon.stub(vscode.window, "createInputBox");
  });

  afterEach(() => {
    createQuickPickStub.restore();
    createInputBoxStub.restore();
  });

  test("Extension should be present", () => {
    assert.ok(vscode.extensions.getExtension("kodapa.kubernetes-seal-unseal"));
  });

  test("Extension should activate", async () => {
    const extension = await vscode.extensions.getExtension("codecontemplator.kubernetes-seal-unseal");
    await extension?.activate();
  });

  function setupQuickPickStub() {
    createQuickPickStub.callsFake(() => {
      var quickPickStub = stubInterface<vscode.QuickPick<vscode.QuickPickItem>>();
      quickPickStub.onDidChangeSelection.callsFake((handler) => {
        switch (quickPickStub.placeholder) {
          case "Select scope":
            const selectedItem = quickPickStub.items.find((x) => x.label === Scope[Scope.strict]);
            const items = [];
            if (selectedItem) {
              items.push(selectedItem);
            }
            return handler(items);
          default:
            throw new Error("Unhandled quick pick");
        }
      });
      return quickPickStub;
    });
  }

  function setupInputBoxStub() {
    createInputBoxStub.callsFake(() => {
      var inputBoxStub = stubInterface<vscode.InputBox>();
      inputBoxStub.onDidAccept.callsFake((asyncHandler) => {
        switch (inputBoxStub.prompt) {
          case "Specify name":
            inputBoxStub.value = "fake-name";
            break;
          case "Specify namespace":
            inputBoxStub.value = "fake-namespace";
            break;
          case "Specify certificate path":
            inputBoxStub.value = path.resolve(__dirname, "../../../example/cert.pem");
            break;
          default:
            throw new Error("Unhandled input box");
        }

        return asyncHandler();
      });
      return inputBoxStub;
    });
  }
});
