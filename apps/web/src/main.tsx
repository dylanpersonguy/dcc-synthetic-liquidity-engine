import React from 'react';
import ReactDOM from 'react-dom/client';
import {
  createBrowserRouter,
  RouterProvider,
  Navigate,
} from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PublicLayout, AdminLayout } from '@/components/layout/Layout';

import { SwapPage } from '@/pages/public/SwapPage';
import { MarketsPage } from '@/pages/public/MarketsPage';
import { MarketDetailPage } from '@/pages/public/MarketDetailPage';
import { ExecutionDetailPage, ExecutionsListPage } from '@/pages/public/ExecutionPages';
import { SyntheticsPage } from '@/pages/public/SyntheticsPage';
import { AdminOverviewPage } from '@/pages/admin/AdminOverviewPage';
import { AdminMarketsPage } from '@/pages/admin/AdminMarketsPage';
import { AdminExecutionsPage } from '@/pages/admin/AdminExecutionsPage';
import { AdminRelayerPage } from '@/pages/admin/AdminRelayerPage';
import { AdminRiskPage } from '@/pages/admin/AdminRiskPage';
import { AdminVenuesPage } from '@/pages/admin/AdminVenuesPage';
import { AdminSyntheticsPage } from '@/pages/admin/AdminSyntheticsPage';
import { AdminPoolsPage } from '@/pages/admin/AdminPoolsPage';

import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5_000,
      refetchOnWindowFocus: false,
    },
  },
});

const router = createBrowserRouter([
  {
    element: <PublicLayout />,
    children: [
      { index: true, element: <Navigate to="/swap" replace /> },
      { path: 'swap', element: <SwapPage /> },
      { path: 'markets', element: <MarketsPage /> },
      { path: 'markets/:slug', element: <MarketDetailPage /> },
      { path: 'executions', element: <ExecutionsListPage /> },
      { path: 'execution/:executionId', element: <ExecutionDetailPage /> },
      { path: 'synthetics', element: <SyntheticsPage /> },
    ],
  },
  {
    path: 'admin',
    element: <AdminLayout />,
    children: [
      { index: true, element: <AdminOverviewPage /> },
      { path: 'markets', element: <AdminMarketsPage /> },
      { path: 'executions', element: <AdminExecutionsPage /> },
      { path: 'relayer', element: <AdminRelayerPage /> },
      { path: 'risk', element: <AdminRiskPage /> },
      { path: 'venues', element: <AdminVenuesPage /> },
      { path: 'synthetics', element: <AdminSyntheticsPage /> },
      { path: 'pools', element: <AdminPoolsPage /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
);
