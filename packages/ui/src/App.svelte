<script lang="ts">
  import { location } from 'svelte-spa-router';
  import Dashboard from './routes/Dashboard.svelte';
  import Configuration from './routes/Configuration.svelte';
  import RoutesIndex from './routes/RoutesIndex.svelte';
  import RouteEditor from './routes/RouteEditor.svelte';
  import NotFound from './routes/NotFound.svelte';
  import ToastContainer from './lib/components/ToastContainer.svelte';
</script>

<div class="min-h-screen bg-base-200">
  <!-- Header -->
  <div class="navbar bg-base-100 shadow-lg sticky top-0 z-50">
    <div class="flex-1">
      <a href="/__ui/#/" class="flex items-center gap-2 px-4 py-2 hover:bg-base-200 rounded-lg transition-colors">
        <!-- Logo Icon -->
        <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
        <!-- Brand -->
        <div class="flex flex-col">
          <span class="text-xl font-bold">Bungee</span>
          <span class="text-xs text-base-content/60">Reverse Proxy</span>
        </div>
      </a>
    </div>

    <!-- Navigation -->
    <div class="flex-none">
      <ul class="menu menu-horizontal px-1 gap-1">
        <li>
          <a
            href="/__ui/#/"
            class:active={$location === '/'}
            class="flex items-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            <span>Dashboard</span>
          </a>
        </li>
        <li>
          <a
            href="/__ui/#/routes"
            class:active={$location.startsWith('/routes')}
            class="flex items-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
            </svg>
            <span>Routes</span>
          </a>
        </li>
        <li>
          <a
            href="/__ui/#/config"
            class:active={$location === '/config'}
            class="flex items-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span>Configuration</span>
          </a>
        </li>
      </ul>
    </div>
  </div>

  <!-- 手动路由（因为 svelte-spa-router 的 onMount 不工作） -->
  {#if $location === '/'}
    <Dashboard />
  {:else if $location === '/routes'}
    <RoutesIndex />
  {:else if $location.startsWith('/routes/edit/')}
    <RouteEditor params={{ path: $location.replace('/routes/edit/', '') }} />
  {:else if $location === '/routes/new'}
    <RouteEditor params={{}} />
  {:else if $location === '/config'}
    <Configuration />
  {:else}
    <NotFound />
  {/if}
</div>

<!-- Toast 通知容器 -->
<ToastContainer />

<style>
  .active {
    background-color: hsl(var(--p) / 0.2);
  }
</style>
