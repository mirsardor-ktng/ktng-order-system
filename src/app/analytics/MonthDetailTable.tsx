'use client';

import { useState, useMemo } from 'react';
import { Search, ChevronUp, ChevronDown, ChevronRight, ChevronLeft } from 'lucide-react';

interface ProductAnalyticsItem {
  productId: string;
  sku: string;
  name: string;
  cases: number;
  revenue: number;
  share: number;
  growth: number;
}

interface MonthDetailTableProps {
  products: ProductAnalyticsItem[];
}

export default function MonthDetailTable({ products }: MonthDetailTableProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState<'sku' | 'name' | 'cases' | 'revenue' | 'growth'>('revenue');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 6;

  // Sorting Handler
  const handleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
    setCurrentPage(1);
  };

  // Filtered & Sorted items
  const processedProducts = useMemo(() => {
    let result = products.filter(p => 
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.sku.toLowerCase().includes(searchTerm.toLowerCase())
    );

    result.sort((a, b) => {
      let valA = a[sortField];
      let valB = b[sortField];

      if (typeof valA === 'string' && typeof valB === 'string') {
        return sortDirection === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      
      // Numbers
      return sortDirection === 'asc' 
        ? (valA as number) - (valB as number) 
        : (valB as number) - (valA as number);
    });

    return result;
  }, [products, searchTerm, sortField, sortDirection]);

  // Pagination
  const totalPages = Math.ceil(processedProducts.length / itemsPerPage);
  const paginatedProducts = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return processedProducts.slice(start, start + itemsPerPage);
  }, [processedProducts, currentPage]);

  const renderSortIcon = (field: typeof sortField) => {
    if (sortField !== field) return null;
    return sortDirection === 'asc' ? <ChevronUp className="w-3.5 h-3.5 ml-1" /> : <ChevronDown className="w-3.5 h-3.5 ml-1" />;
  };

  const formatGrowth = (val: number) => {
    if (val > 0) return <span className="text-emerald-400 font-bold bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded text-[10px] whitespace-nowrap">+{val}%</span>;
    if (val < 0) return <span className="text-red-400 font-bold bg-red-500/10 border border-red-500/20 px-1.5 py-0.5 rounded text-[10px] whitespace-nowrap">{val}%</span>;
    return <span className="text-slate-400 font-bold bg-slate-800 border border-slate-700 px-1.5 py-0.5 rounded text-[10px] whitespace-nowrap">0%</span>;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Детализация продаж по SKU</h4>
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            className="w-full rounded-xl pl-9 pr-4 py-2 text-xs glass-input"
            placeholder="Поиск по SKU или наименованию..."
            value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
          />
        </div>
      </div>

      {paginatedProducts.length === 0 ? (
        <div className="text-center py-8 text-xs text-slate-500">Товары не найдены.</div>
      ) : (
        <>
          <div className="glass-panel rounded-2xl overflow-hidden border border-white/5">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/5 bg-slate-950/40 text-[10px] text-slate-400 uppercase tracking-wider font-extrabold cursor-pointer select-none">
                    <th className="py-3 px-4 hover:text-slate-200" onClick={() => handleSort('sku')}>
                      <div className="flex items-center">SKU {renderSortIcon('sku')}</div>
                    </th>
                    <th className="py-3 px-4 hover:text-slate-200" onClick={() => handleSort('name')}>
                      <div className="flex items-center">Наименование {renderSortIcon('name')}</div>
                    </th>
                    <th className="py-3 px-4 hover:text-slate-200 text-right" onClick={() => handleSort('cases')}>
                      <div className="flex items-center justify-end">Коробок {renderSortIcon('cases')}</div>
                    </th>
                    <th className="py-3 px-4 hover:text-slate-200 text-right" onClick={() => handleSort('revenue')}>
                      <div className="flex items-center justify-end">Выручка {renderSortIcon('revenue')}</div>
                    </th>
                    <th className="py-3 px-4 text-center">Доля</th>
                    <th className="py-3 px-4 hover:text-slate-200 text-center" onClick={() => handleSort('growth')}>
                      <div className="flex items-center justify-center">МоМ Рост {renderSortIcon('growth')}</div>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-xs text-slate-350">
                  {paginatedProducts.map((p) => (
                    <tr key={p.productId} className="hover:bg-white/5 transition-all">
                      <td className="py-3 px-4 font-mono font-bold text-slate-400">{p.sku}</td>
                      <td className="py-3 px-4 font-bold text-slate-200">{p.name}</td>
                      <td className="py-3 px-4 text-right font-extrabold text-slate-100">{p.cases} кор.</td>
                      <td className="py-3 px-4 text-right font-extrabold text-emerald-400">{p.revenue.toLocaleString()} so'm</td>
                      <td className="py-3 px-4 text-center">
                        <span className="text-[10px] text-slate-450 font-bold bg-white/5 px-2 py-0.5 rounded-md border border-white/5">{p.share}%</span>
                      </td>
                      <td className="py-3 px-4 text-center">{formatGrowth(p.growth)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <span className="text-[10px] text-slate-400 font-semibold">
                Страница {currentPage} из {totalPages}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                  disabled={currentPage === 1}
                  className="p-1.5 rounded-lg border border-white/5 bg-slate-900 text-slate-300 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                  disabled={currentPage === totalPages}
                  className="p-1.5 rounded-lg border border-white/5 bg-slate-900 text-slate-300 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
