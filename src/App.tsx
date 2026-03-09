import React, { useState, useEffect, useRef } from 'react';
import { UploadCloud, Receipt, Trash2, DollarSign, Landmark, PieChart, Loader2, Download, Cpu, Cloud, Percent, BarChart as BarChartIcon } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { motion, AnimatePresence } from 'motion/react';

interface ReceiptData {
  id: number;
  total: number;
  tax_federal: number;
  tax_state: number;
  created_at: string;
}

export default function App() {
  const [receipts, setReceipts] = useState<ReceiptData[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [aiEngine, setAiEngine] = useState<'gemini' | 'ollama'>('gemini');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchReceipts();
  }, []);

  const fetchReceipts = async () => {
    try {
      const res = await fetch('/api/receipts');
      const data = await res.json();
      setReceipts(data);
    } catch (error) {
      console.error('Failed to fetch receipts:', error);
    }
  };

  const processFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      alert('Por favor, envie apenas imagens.');
      return;
    }

    setIsProcessing(true);
    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = reader.result as string;
        
        const res = await fetch('/api/receipts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageBase64: base64,
            mimeType: file.type,
            engine: aiEngine
          })
        });

        if (!res.ok) throw new Error('Falha ao processar nota fiscal');
        
        await fetchReceipts();
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error(error);
      alert('Erro ao processar a nota fiscal. Tente novamente.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Tem certeza que deseja excluir este registro?')) return;
    try {
      await fetch(`/api/receipts/${id}`, { method: 'DELETE' });
      await fetchReceipts();
    } catch (error) {
      console.error('Failed to delete receipt:', error);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  };

  const totalGasto = receipts.reduce((acc, curr) => acc + curr.total, 0);
  const totalFederal = receipts.reduce((acc, curr) => acc + curr.tax_federal, 0);
  const totalEstadual = receipts.reduce((acc, curr) => acc + curr.tax_state, 0);
  const totalImpostos = totalFederal + totalEstadual;
  const porcentagemImpostos = totalGasto > 0 ? ((totalImpostos / totalGasto) * 100).toFixed(1) : '0.0';

  const formatCurrency = (val: number) => 
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

  // Prepare data for the chart (grouping by date)
  const chartData = [...receipts].reverse().reduce((acc: any[], curr) => {
    const date = new Date(curr.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    const existing = acc.find((item: any) => item.date === date);
    if (existing) {
      existing.total += curr.total;
    } else {
      acc.push({ date, total: curr.total });
    }
    return acc;
  }, []);

  const exportCSV = () => {
    const headers = ['ID', 'Data', 'Total', 'Federal', 'Estadual'];
    const rows = receipts.map(r => [
      r.id,
      new Date(r.created_at).toLocaleString('pt-BR'),
      r.total,
      r.tax_federal,
      r.tax_state
    ]);
    const csvContent = "data:text/csv;charset=utf-8," 
      + headers.join(",") + "\n" 
      + rows.map(e => e.join(",")).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "notas_fiscais.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="min-h-screen bg-[#f5f5f5] text-gray-900 font-sans p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-8">
        
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Impostos de Mercado</h1>
            <p className="text-gray-500 mt-1">Extração de dados via IA para notas fiscais</p>
          </div>
          
          <div className="flex items-center gap-1 bg-white p-1 rounded-xl border border-gray-200 shadow-sm self-start md:self-auto">
            <button 
              onClick={() => setAiEngine('gemini')}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${aiEngine === 'gemini' ? 'bg-emerald-50 text-emerald-700' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}
            >
              <Cloud size={16} />
              Gemini
            </button>
            <button 
              onClick={() => setAiEngine('ollama')}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${aiEngine === 'ollama' ? 'bg-blue-50 text-blue-700' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}
            >
              <Cpu size={16} />
              Ollama Local
            </button>
          </div>
        </header>

        {/* Dashboard Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col justify-between">
            <div className="flex items-center gap-3 text-gray-500 mb-4">
              <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
                <DollarSign size={20} />
              </div>
              <span className="font-medium">Total Gasto</span>
            </div>
            <div className="text-3xl font-light tracking-tight">{formatCurrency(totalGasto)}</div>
          </div>

          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col justify-between">
            <div className="flex items-center gap-3 text-gray-500 mb-4">
              <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                <Landmark size={20} />
              </div>
              <span className="font-medium">Imposto Federal</span>
            </div>
            <div className="text-3xl font-light tracking-tight">{formatCurrency(totalFederal)}</div>
          </div>

          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col justify-between">
            <div className="flex items-center gap-3 text-gray-500 mb-4">
              <div className="p-2 bg-purple-50 text-purple-600 rounded-lg">
                <PieChart size={20} />
              </div>
              <span className="font-medium">Imposto Estadual</span>
            </div>
            <div className="text-3xl font-light tracking-tight">{formatCurrency(totalEstadual)}</div>
          </div>

          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col justify-between">
            <div className="flex items-center gap-3 text-gray-500 mb-4">
              <div className="p-2 bg-orange-50 text-orange-600 rounded-lg">
                <Percent size={20} />
              </div>
              <span className="font-medium">Carga Tributária</span>
            </div>
            <div className="text-3xl font-light tracking-tight">{porcentagemImpostos}%</div>
          </div>
        </div>

        {/* Upload Area */}
        <motion.div 
          className={`relative border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer overflow-hidden
            ${isDragging ? 'border-emerald-500 bg-emerald-50' : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'}
            ${isProcessing ? 'pointer-events-none' : ''}
          `}
          animate={{
            scale: isDragging ? 1.02 : 1,
            boxShadow: isDragging ? '0 10px 25px -5px rgba(16, 185, 129, 0.2)' : '0 0px 0px 0px rgba(0,0,0,0)',
          }}
          transition={{ type: "spring", stiffness: 300, damping: 20 }}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <AnimatePresence>
            {isDragging && !isProcessing && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-emerald-500/10 flex items-center justify-center z-10 backdrop-blur-[2px]"
              >
                <motion.div 
                  animate={{ y: [0, -10, 0] }}
                  transition={{ repeat: Infinity, duration: 1.5, ease: "easeInOut" }}
                  className="bg-white px-6 py-3 rounded-full shadow-md text-emerald-600 font-semibold flex items-center gap-2"
                >
                  <UploadCloud size={20} />
                  Solte a imagem aqui!
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          <input 
            type="file" 
            ref={fileInputRef} 
            className="hidden" 
            accept="image/*"
            onChange={handleFileSelect}
          />
          
          <div className="flex flex-col items-center gap-4">
            <AnimatePresence mode="wait">
              {isProcessing ? (
                <motion.div 
                  key="processing"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="flex flex-col items-center gap-4 w-full"
                >
                  <div className="relative w-24 h-24 bg-emerald-100 rounded-2xl flex items-center justify-center overflow-hidden shadow-inner">
                    <Receipt size={40} className="text-emerald-600 opacity-40" />
                    {/* Scanning line animation */}
                    <motion.div 
                      className="absolute left-0 w-full h-1 bg-emerald-500 shadow-[0_0_12px_3px_rgba(16,185,129,0.6)]"
                      animate={{ top: ['0%', '100%', '0%'] }}
                      transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
                    />
                  </div>
                  <div>
                    <p className="text-lg font-medium text-gray-900">Analisando nota fiscal...</p>
                    <p className="text-sm text-gray-500 mt-1">A IA está extraindo os valores dos impostos</p>
                  </div>
                </motion.div>
              ) : (
                <motion.div 
                  key="idle"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="flex flex-col items-center gap-4"
                >
                  <div className="p-4 bg-gray-100 rounded-full text-gray-500">
                    <UploadCloud size={32} />
                  </div>
                  <div>
                    <p className="text-lg font-medium text-gray-900">Clique ou arraste a nota fiscal aqui</p>
                    <p className="text-sm text-gray-500 mt-1">Formatos suportados: JPG, PNG, WEBP</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>

        {/* Chart Section */}
        {receipts.length > 0 && (
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
            <h2 className="text-lg font-semibold flex items-center gap-2 mb-6">
              <BarChartIcon size={20} className="text-gray-400" />
              Evolução de Gastos
            </h2>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                  <XAxis 
                    dataKey="date" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fill: '#9ca3af', fontSize: 12 }} 
                    dy={10} 
                  />
                  <YAxis 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fill: '#9ca3af', fontSize: 12 }} 
                    tickFormatter={(value) => `R$ ${value}`} 
                  />
                  <Tooltip 
                    cursor={{ fill: '#f3f4f6' }}
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                    formatter={(value: number) => [formatCurrency(value), 'Total Gasto']}
                    labelStyle={{ color: '#6b7280', fontWeight: 500, marginBottom: '4px' }}
                  />
                  <Bar dataKey="total" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={50} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* History Table */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="p-6 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Receipt size={20} className="text-gray-400" />
              Histórico de Notas
            </h2>
            {receipts.length > 0 && (
              <button
                onClick={exportCSV}
                className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors"
              >
                <Download size={16} />
                Exportar CSV
              </button>
            )}
          </div>
          
          {receipts.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              Nenhuma nota fiscal processada ainda.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50/50 text-gray-500 text-sm uppercase tracking-wider">
                    <th className="p-4 font-medium">Data de Processamento</th>
                    <th className="p-4 font-medium text-right">Total</th>
                    <th className="p-4 font-medium text-right">Federal</th>
                    <th className="p-4 font-medium text-right">Estadual</th>
                    <th className="p-4 font-medium text-center">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {receipts.map((receipt) => (
                    <tr key={receipt.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="p-4 text-gray-600">
                        {new Date(receipt.created_at).toLocaleDateString('pt-BR', {
                          day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
                        })}
                      </td>
                      <td className="p-4 text-right font-mono text-gray-900">
                        {formatCurrency(receipt.total)}
                      </td>
                      <td className="p-4 text-right font-mono text-blue-600">
                        {formatCurrency(receipt.tax_federal)}
                      </td>
                      <td className="p-4 text-right font-mono text-purple-600">
                        {formatCurrency(receipt.tax_state)}
                      </td>
                      <td className="p-4 text-center">
                        <button 
                          onClick={() => handleDelete(receipt.id)}
                          className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors inline-flex"
                          title="Excluir"
                        >
                          <Trash2 size={18} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
