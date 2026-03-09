import React, { useState, useEffect, useRef } from 'react';
import { UploadCloud, Receipt, Trash2, DollarSign, Landmark, PieChart, Loader2, Download, Cpu, Cloud, Percent, BarChart as BarChartIcon, Moon, Sun, CheckCircle2, AlertCircle } from 'lucide-react';
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
  const [ollamaModel, setOllamaModel] = useState('qwen3.5:0.8b');
  const [availableModels, setAvailableModels] = useState<any[]>([]);
  const [ollamaStatus, setOllamaStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [showSuccess, setShowSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchReceipts();
    checkOllama();
    
    // Check system preference for theme
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      setTheme('dark');
    }
  }, []);

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  const checkOllama = async () => {
    setOllamaStatus('checking');
    try {
      const res = await fetch('/api/ollama/check');
      if (res.ok) {
        const data = await res.json();
        setOllamaStatus('online');
        if (data.models && data.models.length > 0) {
          setAvailableModels(data.models);
          if (!data.models.find((m: any) => m.name === ollamaModel)) {
            setOllamaModel(data.models[0].name);
          }
        }
      } else {
        setOllamaStatus('offline');
      }
    } catch (error) {
      setOllamaStatus('offline');
    }
  };

  const handleEngineSwitch = (engine: 'gemini' | 'ollama') => {
    setAiEngine(engine);
    if (engine === 'ollama') {
      checkOllama();
    }
  };

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
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      
      const res = await fetch('/api/receipts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: base64,
          mimeType: file.type,
          engine: aiEngine,
          ollamaModel: ollamaModel
        })
      });

      if (!res.ok) throw new Error('Falha ao processar nota fiscal');
      
      await fetchReceipts();
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 3000);
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

  const maxFederal = Math.max(...receipts.map(r => r.tax_federal), 0);
  const maxEstadual = Math.max(...receipts.map(r => r.tax_state), 0);

  const getIntensityClass = (val: number, max: number, color: 'blue' | 'purple') => {
    if (max === 0) return color === 'blue' ? 'text-blue-500 dark:text-blue-400' : 'text-purple-500 dark:text-purple-400';
    const ratio = val / max;
    if (color === 'blue') {
      if (ratio > 0.75) return 'text-blue-700 dark:text-blue-300 font-bold';
      if (ratio > 0.5) return 'text-blue-600 dark:text-blue-400 font-semibold';
      if (ratio > 0.25) return 'text-blue-500 dark:text-blue-500 font-medium';
      return 'text-blue-400 dark:text-blue-600';
    } else {
      if (ratio > 0.75) return 'text-purple-700 dark:text-purple-300 font-bold';
      if (ratio > 0.5) return 'text-purple-600 dark:text-purple-400 font-semibold';
      if (ratio > 0.25) return 'text-purple-500 dark:text-purple-500 font-medium';
      return 'text-purple-400 dark:text-purple-600';
    }
  };

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
    <div className="min-h-screen bg-[#f5f5f5] dark:bg-gray-950 text-gray-900 dark:text-gray-100 font-sans p-4 md:p-8 transition-colors duration-200">
      <div className="max-w-5xl mx-auto space-y-8">
        
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Impostos de Mercado</h1>
            <p className="text-gray-500 dark:text-gray-400 mt-1">Extração de dados via IA para notas fiscais</p>
          </div>
          
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 self-start md:self-auto">
            <div className="flex items-center gap-1 bg-white dark:bg-gray-900 p-1 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm">
              <button 
                onClick={() => handleEngineSwitch('gemini')}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${aiEngine === 'gemini' ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800'}`}
              >
                <Cloud size={16} />
                Gemini
              </button>
              <button 
                onClick={() => handleEngineSwitch('ollama')}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${aiEngine === 'ollama' ? 'bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800'}`}
              >
                <Cpu size={16} />
                Ollama Local
              </button>
            </div>

            <button
              onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
              className="p-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 shadow-sm transition-colors"
              title="Alternar Tema"
            >
              {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
            </button>
          </div>
        </header>

        {/* Ollama Status & Model Selection */}
        <AnimatePresence>
          {aiEngine === 'ollama' && (
            <motion.div 
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="bg-blue-50/50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-800/30 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  {ollamaStatus === 'checking' && <Loader2 size={18} className="text-blue-500 animate-spin" />}
                  {ollamaStatus === 'online' && <CheckCircle2 size={18} className="text-emerald-500" />}
                  {ollamaStatus === 'offline' && <AlertCircle size={18} className="text-red-500" />}
                  
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Status do Ollama: 
                    <span className={`ml-1 ${ollamaStatus === 'online' ? 'text-emerald-600 dark:text-emerald-400' : ollamaStatus === 'offline' ? 'text-red-600 dark:text-red-400' : 'text-blue-600 dark:text-blue-400'}`}>
                      {ollamaStatus === 'checking' ? 'Verificando...' : ollamaStatus === 'online' ? 'Conectado' : 'Desconectado'}
                    </span>
                  </span>
                  
                  {ollamaStatus === 'offline' && (
                    <button onClick={checkOllama} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">
                      Tentar novamente
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <label htmlFor="ollama-model" className="text-sm text-gray-500 dark:text-gray-400">Modelo:</label>
                  <select 
                    id="ollama-model"
                    value={ollamaModel}
                    onChange={(e) => setOllamaModel(e.target.value)}
                    className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2 outline-none"
                  >
                    {availableModels.length > 0 ? (
                      availableModels.map((m: any) => (
                        <option key={m.name} value={m.name}>{m.name}</option>
                      ))
                    ) : (
                      <option value="qwen3.5:0.8b">Qwen3.5 (0.8b)</option>
                    )}
                  </select>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Dashboard Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 flex flex-col justify-between transition-colors">
            <div className="flex items-center gap-3 text-gray-500 dark:text-gray-400 mb-4">
              <div className="p-2 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-lg">
                <DollarSign size={20} />
              </div>
              <span className="font-medium">Total Gasto</span>
            </div>
            <div className="text-3xl font-light tracking-tight">{formatCurrency(totalGasto)}</div>
          </div>

          <div className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 flex flex-col justify-between transition-colors">
            <div className="flex items-center gap-3 text-gray-500 dark:text-gray-400 mb-4">
              <div className="p-2 bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-lg">
                <Landmark size={20} />
              </div>
              <span className="font-medium">Imposto Federal</span>
            </div>
            <div className="text-3xl font-light tracking-tight">{formatCurrency(totalFederal)}</div>
          </div>

          <div className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 flex flex-col justify-between transition-colors">
            <div className="flex items-center gap-3 text-gray-500 dark:text-gray-400 mb-4">
              <div className="p-2 bg-purple-50 dark:bg-purple-500/10 text-purple-600 dark:text-purple-400 rounded-lg">
                <PieChart size={20} />
              </div>
              <span className="font-medium">Imposto Estadual</span>
            </div>
            <div className="text-3xl font-light tracking-tight">{formatCurrency(totalEstadual)}</div>
          </div>

          <div className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 flex flex-col justify-between transition-colors">
            <div className="flex items-center gap-3 text-gray-500 dark:text-gray-400 mb-4">
              <div className="p-2 bg-orange-50 dark:bg-orange-500/10 text-orange-600 dark:text-orange-400 rounded-lg">
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
            ${isDragging ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10' : 'border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:border-gray-300 dark:hover:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50'}
            ${isProcessing || (aiEngine === 'ollama' && ollamaStatus !== 'online') ? 'pointer-events-none opacity-60' : ''}
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
                  className="flex flex-col items-center gap-6 w-full py-4"
                >
                  <div className="relative w-32 h-32 bg-emerald-50 dark:bg-emerald-900/20 rounded-3xl flex items-center justify-center overflow-hidden shadow-inner border border-emerald-100 dark:border-emerald-800/50">
                    <motion.div
                      animate={{ scale: [1, 1.1, 1], opacity: [0.5, 1, 0.5] }}
                      transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
                    >
                      <Receipt size={48} className="text-emerald-500 dark:text-emerald-400" />
                    </motion.div>
                    {/* Scanning line animation */}
                    <motion.div 
                      className="absolute left-0 w-full h-1.5 bg-gradient-to-r from-transparent via-emerald-400 to-transparent shadow-[0_0_15px_5px_rgba(52,211,153,0.5)] blur-[1px]"
                      animate={{ top: ['-10%', '110%', '-10%'] }}
                      transition={{ repeat: Infinity, duration: 2.5, ease: "linear" }}
                    />
                  </div>
                  <div className="space-y-2">
                    <p className="text-xl font-semibold text-gray-900 dark:text-gray-100 flex items-center justify-center gap-2">
                      Analisando nota fiscal
                      <motion.span
                        animate={{ opacity: [0, 1, 0] }}
                        transition={{ repeat: Infinity, duration: 1.5, times: [0, 0.5, 1] }}
                      >...</motion.span>
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Extraindo valores e impostos com IA</p>
                  </div>
                </motion.div>
              ) : showSuccess ? (
                <motion.div 
                  key="success"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  className="flex flex-col items-center gap-4 text-emerald-600 dark:text-emerald-400"
                >
                  <div className="p-4 bg-emerald-100 dark:bg-emerald-900/30 rounded-full">
                    <CheckCircle2 size={48} />
                  </div>
                  <div>
                    <p className="text-lg font-medium">Nota processada com sucesso!</p>
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
                  <div className="p-4 bg-gray-100 dark:bg-gray-800 rounded-full text-gray-500 dark:text-gray-400">
                    <UploadCloud size={32} />
                  </div>
                  <div>
                    <p className="text-lg font-medium text-gray-900 dark:text-gray-100">Clique ou arraste a nota fiscal aqui</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Formatos suportados: JPG, PNG, WEBP</p>
                    {aiEngine === 'ollama' && ollamaStatus !== 'online' && (
                      <p className="text-sm text-red-500 mt-2 font-medium">Ollama indisponível. Verifique a conexão.</p>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>

        {/* Chart Section */}
        {receipts.length > 0 && (
          <div className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 transition-colors">
            <h2 className="text-lg font-semibold flex items-center gap-2 mb-6 text-gray-900 dark:text-gray-100">
              <BarChartIcon size={20} className="text-gray-400 dark:text-gray-500" />
              Evolução de Gastos
            </h2>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={theme === 'dark' ? '#374151' : '#f0f0f0'} />
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
                    cursor={{ fill: theme === 'dark' ? '#1f2937' : '#f3f4f6' }}
                    contentStyle={{ 
                      borderRadius: '12px', 
                      border: 'none', 
                      boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                      backgroundColor: theme === 'dark' ? '#111827' : '#ffffff',
                      color: theme === 'dark' ? '#f3f4f6' : '#111827'
                    }}
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
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 overflow-hidden transition-colors">
          <div className="p-6 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
            <h2 className="text-lg font-semibold flex items-center gap-2 text-gray-900 dark:text-gray-100">
              <Receipt size={20} className="text-gray-400 dark:text-gray-500" />
              Histórico de Notas
            </h2>
            {receipts.length > 0 && (
              <button
                onClick={exportCSV}
                className="flex items-center gap-2 px-4 py-2 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-sm font-medium rounded-lg hover:bg-gray-800 dark:hover:bg-white transition-colors"
              >
                <Download size={16} />
                Exportar CSV
              </button>
            )}
          </div>
          
          {receipts.length === 0 ? (
            <div className="p-8 text-center text-gray-500 dark:text-gray-400">
              Nenhuma nota fiscal processada ainda.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50/50 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400 text-sm uppercase tracking-wider">
                    <th className="p-4 font-medium">Data de Processamento</th>
                    <th className="p-4 font-medium text-right">Total</th>
                    <th className="p-4 font-medium text-right">Federal</th>
                    <th className="p-4 font-medium text-right">Estadual</th>
                    <th className="p-4 font-medium text-center">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {receipts.map((receipt) => (
                    <tr key={receipt.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors">
                      <td className="p-4 text-gray-600 dark:text-gray-300">
                        {new Date(receipt.created_at).toLocaleDateString('pt-BR', {
                          day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
                        })}
                      </td>
                      <td className="p-4 text-right font-mono text-gray-900 dark:text-gray-100">
                        {formatCurrency(receipt.total)}
                      </td>
                      <td className={`p-4 text-right font-mono ${getIntensityClass(receipt.tax_federal, maxFederal, 'blue')}`}>
                        {formatCurrency(receipt.tax_federal)}
                      </td>
                      <td className={`p-4 text-right font-mono ${getIntensityClass(receipt.tax_state, maxEstadual, 'purple')}`}>
                        {formatCurrency(receipt.tax_state)}
                      </td>
                      <td className="p-4 text-center">
                        <button 
                          onClick={() => handleDelete(receipt.id)}
                          className="p-2 text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors inline-flex"
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
