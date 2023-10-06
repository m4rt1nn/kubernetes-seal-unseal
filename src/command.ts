import { Scope, SealSecretParameters } from "./types";
import { fileSync } from "tmp";
import { writeFileSync, readFileSync } from "fs";
import { exec, spawnSync } from "child_process";

export async function sealSecretRaw(
  kubesealPath: string,
  plainTextSecret: string,
  sealSecretParams: SealSecretParameters,
  localCert: boolean,
  controllerNamespace: string | undefined
): Promise<string> {
  // Write secret to a temporary file to since --from-file=stdin does not work on windows. This is a known problem at the time of writing.
  const temporaryFile = fileSync();
  writeFileSync(temporaryFile.name, plainTextSecret);

  const ctrlNS = controllerNamespace || "kube-system";

  // Construct command line
  const normalizedTemporaryFilename = temporaryFile.name.replace(/\\/g, "/");
  const normalizedCertificatePath = `file://${sealSecretParams.certificatePath?.replace(/\\/g, "/")}`;
  let command = "";
  switch (sealSecretParams.scope) {
    case Scope.strict:
      command = `${kubesealPath} --raw --from-file="${normalizedTemporaryFilename}" --namespace "${sealSecretParams.namespace}" --name "${sealSecretParams.name}" --controller-namespace "${ctrlNS}"`;
      break;
    case Scope.namespaceWide:
      command = `${kubesealPath} --raw --from-file="${normalizedTemporaryFilename}" --namespace "${sealSecretParams.namespace}" --scope namespace-wide --controller-namespace "${ctrlNS}"`;
      break;
    case Scope.clusterWide:
      command = `${kubesealPath} --raw --from-file="${normalizedTemporaryFilename}" --scope cluster-wide --controller-namespace "${ctrlNS}"`;
      break;
    default:
      throw new Error(`Internal error. Unknown scope ${sealSecretParams.scope}`);
  }
  if (localCert) {
    command = `${command} --cert "${normalizedCertificatePath}"`;
  }

  // Execute command line
  return new Promise<string>((resolve, reject) => {
    exec(command, {}, (error, stdout) => {
      if (error) {
        reject(error.message);
      } else {
        resolve(stdout);
      }
    });
  }).finally(temporaryFile.removeCallback);
}

export async function sealSecretFile(
  kubesealPath: string,
  secretFilePath: string,
  sealSecretParams: SealSecretParameters,
  localCert: boolean,
  controllerNamespace: string | undefined
): Promise<string> {
  // Get file data
  const secretFileData = readFileSync(secretFilePath);

  const ctrlNS = controllerNamespace || "kube-system";

  // Construct command line
  const normalizedCertificatePath = `file://${sealSecretParams.certificatePath?.replace(/\\/g, "/")}`;
  let command = "";
  switch (sealSecretParams.scope) {
    case Scope.strict:
      command = `${kubesealPath} --namespace "${sealSecretParams.namespace}" --name "${sealSecretParams.name}" --format yaml --controller-namespace "${ctrlNS}"`;
      break;
    case Scope.namespaceWide:
      command = `${kubesealPath} --namespace "${sealSecretParams.namespace}" --scope namespace-wide --format yaml --controller-namespace "${ctrlNS}"`;
      break;
    case Scope.clusterWide:
      command = `${kubesealPath} --scope cluster-wide --format yaml --controller-namespace "${ctrlNS}"`;
      break;
    default:
      throw new Error(`Internal error. Unknown scope ${sealSecretParams.scope}`);
  }
  if (localCert) {
    command = `${command} --cert "${normalizedCertificatePath}"`;
  }

  // Execute command line
  return new Promise<string>((resolve, reject) => {
    const cmdProcess = exec(command, {}, (error, stdout) => {
      if (error) {
        reject(error.message);
      } else {
        resolve(stdout);
      }
    });

    cmdProcess.stdin?.end(secretFileData);
  });
}

export async function unsealSecretFile(
  ocPath: string,
  secretName: string,
  nameSpace: string,
  secretFilePath: string
): Promise<string> {
  const secretFileData = readFileSync(secretFilePath);

  const command = `${ocPath} get secret ${secretName} -n ${nameSpace} -o yaml`;
  // Execute command line
  return new Promise<string>((resolve, reject) => {
    const cmdProcess = exec(command, {}, (error, stdout) => {
      if (error) {
        reject(error.message);
      } else {
        resolve(stdout);
      }
    });

    cmdProcess.stdin?.end(secretFileData);
  });
}

export function isLoggedOut(ocPath: string | undefined) {
  const cmdProcess = spawnSync(`${ocPath}`, ["whoami"]);
  if (cmdProcess.error) {
    return true;
  } else {
    return false;
  }
}
