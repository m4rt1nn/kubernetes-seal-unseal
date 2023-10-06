export enum Scope {
  strict = 0,
  namespaceWide = 1,
  clusterWide = 2,
}

export interface SealSecretParameters {
  certificatePath: string | undefined;
  name: string | undefined;
  namespace: string | undefined;
  scope: Scope | undefined;
}

export interface ExtensionState {
  kubeSealPath: string | undefined;
  ocPath: string | undefined;
  sealSecretParams: SealSecretParameters | undefined;
  localCert: boolean | true;
  controllerNamespace: string | undefined;
}
