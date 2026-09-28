export async function createIsolatedWasmFileset(filesetResolver, wasmRoot, taskName) {
  if (!filesetResolver || typeof filesetResolver.forVisionTasks !== 'function') {
    throw new TypeError('mediapipe_fileset_resolver_missing');
  }
  if (typeof taskName !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/u.test(taskName)) {
    throw new TypeError('mediapipe_task_name_invalid');
  }
  const fileset = await filesetResolver.forVisionTasks(wasmRoot, true);
  const loaderUrl = new URL(fileset.wasmLoaderPath);
  loaderUrl.searchParams.set('task', taskName);
  return { ...fileset, wasmLoaderPath: loaderUrl.href };
}
