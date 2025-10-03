<script lang="ts">
  import { onMount } from 'svelte';
  import { push } from 'svelte-spa-router';
  import { RoutesAPI } from '../lib/api/routes';
  import type { Route } from '../lib/api/routes';
  import RouteCard from '../lib/components/RouteCard.svelte';
  import ConfirmDialog from '../lib/components/ConfirmDialog.svelte';
  import { toast } from '../lib/stores/toast';

  let routes: Route[] = [];
  let loading = true;
  let error: string | null = null;
  let searchQuery = '';
  let filterTransformer = '';

  // 确认对话框状态
  let showDeleteDialog = false;
  let routeToDelete: Route | null = null;

  // 加载状态跟踪
  let deletingPaths = new Set<string>();
  let duplicatingPaths = new Set<string>();
  let importing = false;

  async function loadRoutes() {
    try {
      loading = true;
      routes = await RoutesAPI.list();
      error = null;
    } catch (e: any) {
      error = e.message;
      toast.show(e.message, 'error');
    } finally {
      loading = false;
    }
  }

  async function handleDelete(route: Route) {
    routeToDelete = route;
    showDeleteDialog = true;
  }

  async function confirmDelete() {
    if (!routeToDelete) return;

    deletingPaths.add(routeToDelete.path);
    deletingPaths = deletingPaths; // 触发响应式更新

    try {
      await RoutesAPI.delete(routeToDelete.path);
      toast.show(`路由 "${routeToDelete.path}" 已删除`, 'success');
      await loadRoutes();
    } catch (e: any) {
      toast.show(`删除失败: ${e.message}`, 'error');
    } finally {
      deletingPaths.delete(routeToDelete.path);
      deletingPaths = deletingPaths;
      routeToDelete = null;
    }
  }

  function cancelDelete() {
    routeToDelete = null;
  }

  async function handleDuplicate(route: Route) {
    duplicatingPaths.add(route.path);
    duplicatingPaths = duplicatingPaths;

    try {
      await RoutesAPI.duplicate(route.path);
      toast.show(`路由 "${route.path}" 已复制`, 'success');
      await loadRoutes();
    } catch (e: any) {
      toast.show(`复制失败: ${e.message}`, 'error');
    } finally {
      duplicatingPaths.delete(route.path);
      duplicatingPaths = duplicatingPaths;
    }
  }

  function handleCreate() {
    push('/routes/new');
  }

  function handleExportAll() {
    if (routes.length === 0) {
      toast.show('没有可导出的路由', 'warning');
      return;
    }

    const dataStr = JSON.stringify(routes, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    const exportFileDefaultName = `bungee-routes-${new Date().toISOString().split('T')[0]}.json`;

    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
    toast.show('路由已导出', 'success');
  }

  function handleImportRoutes() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e: any) => {
      const file = e.target.files[0];
      if (!file) return;

      importing = true;
      try {
        const text = await file.text();
        const imported = JSON.parse(text);

        if (!Array.isArray(imported)) {
          throw new Error('导入文件必须是路由数组');
        }

        // 批量创建路由
        let successCount = 0;
        let failCount = 0;

        for (const route of imported) {
          try {
            await RoutesAPI.create(route);
            successCount++;
          } catch (err: any) {
            failCount++;
            console.error(`Failed to import route ${route.path}:`, err);
          }
        }

        if (successCount > 0) {
          toast.show(`成功导入 ${successCount} 个路由${failCount > 0 ? `，失败 ${failCount} 个` : ''}`, 'success');
          await loadRoutes();
        } else {
          toast.show(`导入失败: ${failCount} 个路由导入失败`, 'error');
        }
      } catch (err: any) {
        toast.show(`导入失败: ${err.message}`, 'error');
      } finally {
        importing = false;
      }
    };
    input.click();
  }

  // Filtered routes
  $: filteredRoutes = routes.filter(route => {
    const matchesSearch = route.path.toLowerCase().includes(searchQuery.toLowerCase()) ||
      route.upstreams.some(u => u.target.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesTransformer = !filterTransformer ||
      (typeof route.transformer === 'string' && route.transformer === filterTransformer) ||
      route.upstreams.some(u =>
        typeof u.transformer === 'string' && u.transformer === filterTransformer
      );

    return matchesSearch && matchesTransformer;
  });

  // Get unique transformers for filter
  $: transformers = Array.from(
    new Set(
      routes.flatMap(r => {
        const t: string[] = [];
        if (typeof r.transformer === 'string') t.push(r.transformer);
        r.upstreams.forEach(u => {
          if (typeof u.transformer === 'string') t.push(u.transformer);
        });
        return t;
      })
    )
  );

  onMount(() => {
    loadRoutes();
  });
</script>

<div class="p-6">
  <!-- Header -->
  <div class="flex justify-between items-center mb-6">
    <div>
      <h1 class="text-3xl font-bold">Routes</h1>
      <p class="text-sm text-gray-500 mt-1">
        Manage your reverse proxy routes and upstreams
      </p>
    </div>
    <div class="flex gap-2">
      <button
        class="btn btn-sm btn-outline"
        on:click={handleExportAll}
        disabled={loading || routes.length === 0}
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
        Export
      </button>
      <button
        class="btn btn-sm btn-outline"
        on:click={handleImportRoutes}
        disabled={loading || importing}
      >
        {#if importing}
          <span class="loading loading-spinner loading-xs"></span>
        {:else}
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
        {/if}
        Import
      </button>
      <button class="btn btn-primary btn-sm" on:click={handleCreate}>
        + New Route
      </button>
    </div>
  </div>

  <!-- Filters -->
  <div class="flex gap-4 mb-6">
    <div class="form-control flex-1">
      <input
        type="text"
        placeholder="Search routes or upstreams..."
        class="input input-bordered"
        bind:value={searchQuery}
      />
    </div>
    <div class="form-control w-64">
      <select class="select select-bordered" bind:value={filterTransformer}>
        <option value="">All Transformers</option>
        {#each transformers as transformer}
          <option value={transformer}>{transformer}</option>
        {/each}
      </select>
    </div>
  </div>

  <!-- Content -->
  {#if loading}
    <div class="flex justify-center items-center h-64">
      <span class="loading loading-spinner loading-lg"></span>
    </div>
  {:else if error}
    <div class="alert alert-error">
      <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <span>Error: {error}</span>
    </div>
  {:else if filteredRoutes.length === 0}
    <div class="text-center py-12">
      {#if routes.length === 0}
        <div class="text-6xl mb-4">🚀</div>
        <h3 class="text-xl font-semibold mb-2">No routes configured</h3>
        <p class="text-gray-500 mb-4">
          Create your first route to start proxying requests
        </p>
        <button class="btn btn-primary" on:click={handleCreate}>
          Create First Route
        </button>
      {:else}
        <div class="text-6xl mb-4">🔍</div>
        <h3 class="text-xl font-semibold mb-2">No matching routes</h3>
        <p class="text-gray-500">
          Try adjusting your search or filter criteria
        </p>
      {/if}
    </div>
  {:else}
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {#each filteredRoutes as route}
        <RouteCard
          {route}
          onDelete={() => handleDelete(route)}
          onDuplicate={() => handleDuplicate(route)}
          isDeleting={deletingPaths.has(route.path)}
          isDuplicating={duplicatingPaths.has(route.path)}
        />
      {/each}
    </div>
  {/if}

  <!-- Stats -->
  {#if !loading && routes.length > 0}
    <div class="mt-6 text-sm text-gray-500 text-center">
      Showing {filteredRoutes.length} of {routes.length} route{routes.length !== 1 ? 's' : ''}
    </div>
  {/if}

  <!-- 删除确认对话框 -->
  <ConfirmDialog
    bind:open={showDeleteDialog}
    title="确认删除路由"
    message={routeToDelete ? `确定要删除路由 "${routeToDelete.path}" 吗？此操作无法撤销。` : ''}
    confirmText="删除"
    cancelText="取消"
    confirmClass="btn-error"
    on:confirm={confirmDelete}
    on:cancel={cancelDelete}
  />
</div>
