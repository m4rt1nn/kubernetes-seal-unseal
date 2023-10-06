import { TextDocument } from "vscode";
import { safeLoad } from "js-yaml";
import { SealSecretParameters, Scope } from "./types";

export function collectDefaults(
  document: TextDocument,
  lastUsed: SealSecretParameters | null = null
): SealSecretParameters {
  // Create result structure
  let result = lastUsed || {
    certificatePath: undefined,
    name: undefined,
    namespace: undefined,
    scope: undefined,
  };

  // Try to extract name, namespace and scope from document
  try {
    const documentText = document.getText();
    const documentDom: any = safeLoad(documentText);
    result.name = documentDom?.metadata?.name;
    result.namespace = documentDom?.metadata?.namespace;
    const annotations = documentDom?.metadata?.annotations;
    if (annotations && annotations["sealedsecrets.bitnami.com/cluster-wide"] === "true") {
      result.scope = Scope.clusterWide;
    } else if (annotations && annotations["sealedsecrets.bitnami.com/namespace-wide"] === "true") {
      result.scope = Scope.namespaceWide;
    } else if (documentDom?.metadata) {
      result.scope = Scope.strict;
    }
  } catch (error) {}

  // Return
  return result;
}
