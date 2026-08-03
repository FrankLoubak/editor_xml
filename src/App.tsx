/**
 * Editor XML — importa um XML de NF-e, identifica peças que formam um
 * conjunto (kit) e permite ao usuário confirmar, montar novos conjuntos
 * manualmente, ou ignorar as sugestões antes de finalizar.
 *
 * Portado de FrankLoubak/Frente-de-Loja (src/App.tsx, aba "Importar XML").
 * Esta versão é client-side: não depende de backend/banco de dados — o
 * resultado final é exportado como JSON.
 */

import React, { useState, useCallback, useEffect } from 'react';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import {
  Upload, AlertCircle, ChevronRight, Package,
  Building2, ReceiptText, GitMerge, CheckSquare, Square,
  X, RotateCcw, Download, CheckCircle2, Undo2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn, formatCurrency } from './lib/utils';
import { NFeData, NFeItem } from './types';

function Card({ icon, label, value, subValue }: { icon: React.ReactNode; label: string; value: string; subValue: string }) {
  return (
    <div className="bg-white rounded-2xl border border-zinc-200 p-5 shadow-sm flex items-start gap-4">
      <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-xl flex-shrink-0">{icon}</div>
      <div className="min-w-0">
        <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">{label}</div>
        <div className="text-lg font-bold text-zinc-900 truncate">{value}</div>
        <div className="text-xs text-zinc-500 truncate">{subValue}</div>
      </div>
    </div>
  );
}

export default function App() {
  const [nfeData, setNfeData] = useState<NFeData | null>(null);
  // Blocos do NF-e original que não aparecem na tela mas precisam ser
  // repassados ao exportar (mesmo formato de XML de nota fiscal): cabeçalho
  // completo (ide/emit/dest/total/transp/cobr/pag/infAdic/infRespTec) e os
  // <det> originais, indexados pelo número do item, para reaproveitar sem
  // perdas os itens que não entraram em nenhum conjunto.
  const [rawNFe, setRawNFe] = useState<Record<string, any> | null>(null);
  const [rawDetByItem, setRawDetByItem] = useState<Record<number, any>>({});
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [markupInput, setMarkupInput] = useState<string>("0");
  const [confirmed, setConfirmed] = useState(false);

  const [suggestedMerges, setSuggestedMerges] = useState<{
    item1: NFeItem;
    item2: NFeItem;
    suggestedName: string;
  }[]>([]);
  const [selectedSuggestedMerges, setSelectedSuggestedMerges] = useState<number[]>([]);
  // Sugestões de estender uma junção manual para outras variações de
  // tamanho (P/M/G/GG/XG) das mesmas 2 peças.
  const [sizeExtension, setSizeExtension] = useState<{
    item1: NFeItem;
    item2: NFeItem;
    suggestedName: string;
  }[] | null>(null);
  const [selectedSizeExtension, setSelectedSizeExtension] = useState<number[]>([]);
  const [mergeState, setMergeState] = useState<{
    isOpen: boolean;
    firstItem: NFeItem | null;
    secondItem: NFeItem | null;
    newName: string;
  }>({
    isOpen: false,
    firstItem: null,
    secondItem: null,
    newName: "",
  });

  const openMerge = (item: NFeItem) => {
    setMergeState({ isOpen: true, firstItem: item, secondItem: null, newName: "" });
  };

  // Separa os nomes em: parte exclusiva de cada peça (palavras que só
  // aparecem numa ou noutra) e a parte comum (sufixo compartilhado pelas
  // duas, geralmente cor/tamanho).
  const splitByCommonSuffix = (str1: string, str2: string) => {
    const parts1 = str1.split(' ');
    const parts2 = str2.split(' ');
    const suffix: string[] = [];
    let i = parts1.length - 1;
    let j = parts2.length - 1;
    while (i >= 0 && j >= 0 && parts1[i] === parts2[j]) {
      suffix.unshift(parts1[i]);
      i--;
      j--;
    }
    return {
      exclusive1: parts1.slice(0, i + 1),
      exclusive2: parts2.slice(0, j + 1),
      suffix,
    };
  };

  // Palavras que indicam o tipo da peça (não o modelo/atributo dela) — não
  // entram no nome sugerido do conjunto, só os atributos de cada peça.
  const TIPO_PECA_RE = /^(calcinhas?|tops?|cal[çc]as?|shorts?)$/i;
  const removerTipoPeca = (palavras: string[]) => palavras.filter(p => !TIPO_PECA_RE.test(p));

  // Sem acentuação nem "ç" — como se fosse digitado num teclado americano.
  // O sistema de vendas que importa o XML não lê acentuação corretamente
  // (nem em UTF-8 nem em ISO-8859-1), então o nome do conjunto/biquíni é
  // gerado já sem acentos para evitar o problema de vez.
  const removerAcentos = (str: string) => str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // Monta o nome do conjunto/biquíni a partir de 2 descrições, sem o gate de
  // "sufixo comum longo o bastante" — usado quando a correspondência entre
  // as peças já foi validada por outro caminho (ex: mesma base + tamanho).
  const buildMergedName = (str1: string, str2: string) => {
    const { exclusive1, exclusive2, suffix } = splitByCommonSuffix(str1, str2);
    // Quando uma das peças é uma calcinha, o conjunto resultante é um biquíni.
    const isBiquini = /calcinha/i.test(str1) || /calcinha/i.test(str2);
    const tipo = isBiquini ? 'BIQUINI' : 'CONJUNTO';
    // Nome: tipo, depois o que é exclusivo de cada peça (sem a palavra do
    // tipo em si), depois o que é comum às duas.
    const atributos1 = removerTipoPeca(exclusive1);
    const atributos2 = removerTipoPeca(exclusive2);
    const nome = [tipo, ...atributos1, ...atributos2, ...suffix].filter(Boolean).join(' ');
    return removerAcentos(nome);
  };

  const suggestMergeName = (str1: string, str2: string) => {
    const { suffix } = splitByCommonSuffix(str1, str2);
    if (suffix.join(' ').length > 3) {
      return buildMergedName(str1, str2);
    }
    return "";
  };

  // Classifica o "tipo" da peça pelo nome — duas peças do mesmo tipo (duas
  // calcinhas, dois tops, etc.) nunca formam um conjunto entre si.
  const pieceType = (descricao: string): string | null => {
    if (/calcinha/i.test(descricao)) return 'calcinha';
    if (/\btop\b/i.test(descricao) || /sut(i|ã)/i.test(descricao)) return 'top';
    return null;
  };

  const sameType = (str1: string, str2: string) => {
    const t1 = pieceType(str1);
    return t1 !== null && t1 === pieceType(str2);
  };

  // Uma peça continua disponível para novas junções enquanto ainda sobrar
  // quantidade não usada — só fica indisponível quando todas as unidades já
  // viraram conjunto (quantidadeUsada === quantidade).
  const isDisponivel = (i: NFeItem) => (i.quantidadeUsada ?? 0) < i.quantidade;

  // Varre os itens ainda disponíveis (com quantidade não usada) em busca
  // de pares com sufixo de nome em comum, sugerindo a junção automaticamente.
  useEffect(() => {
    if (!nfeData) {
      setSuggestedMerges([]);
      setSelectedSuggestedMerges([]);
      return;
    }

    const suggestions: { item1: NFeItem; item2: NFeItem; suggestedName: string }[] = [];
    const processed = new Set<number>();
    const availableItems = nfeData.itens.filter(i => isDisponivel(i) && !i.conjunto?.includes('Composto'));

    for (let i = 0; i < availableItems.length; i++) {
      if (processed.has(availableItems[i].item)) continue;
      for (let j = i + 1; j < availableItems.length; j++) {
        if (processed.has(availableItems[j].item)) continue;
        if (sameType(availableItems[i].descricao, availableItems[j].descricao)) continue;

        const suggestedName = suggestMergeName(availableItems[i].descricao, availableItems[j].descricao);
        if (suggestedName) {
          suggestions.push({ item1: availableItems[i], item2: availableItems[j], suggestedName });
          processed.add(availableItems[i].item);
          processed.add(availableItems[j].item);
          break;
        }
      }
    }

    setSuggestedMerges(suggestions);
    setSelectedSuggestedMerges(suggestions.map((_, idx) => idx));
  }, [nfeData]);

  const calculateMarkupPrice = (cost: number) => {
    const markup = parseFloat(markupInput) || 0;
    return cost * (1 + markup / 100);
  };

  // Aplica uma lista de pares (item1, item2, nome sugerido) sobre uma lista
  // de itens: cria o conjunto composto e marca os 2 originais como
  // integrados. Compartilhado entre a confirmação em lote das sugestões
  // automáticas e a extensão de tamanhos após uma junção manual.
  const applyMergePairs = (
    pairs: { item1: NFeItem; item2: NFeItem; suggestedName: string }[],
    baseItens: NFeItem[]
  ): NFeItem[] => {
    let currentItens = [...baseItens];
    let nextItemNumber = Math.max(...currentItens.map(i => i.item)) + 1;

    pairs.forEach(({ item1, item2, suggestedName }) => {
      const totalCost = item1.valorUnitario + item2.valorUnitario;

      const newItem: NFeItem = {
        item: nextItemNumber++,
        codigo: `CJ-${item1.codigo}-${item2.codigo}`,
        descricao: suggestedName.toUpperCase(),
        ncm: item1.ncm,
        cfop: item1.cfop,
        unidade: "UN",
        quantidade: 1,
        valorUnitario: totalCost,
        valorTotal: totalCost,
        codigo_barras: `CJ${Date.now()}${nextItemNumber}`,
        conjunto: `Composto por: ${item1.codigo} e ${item2.codigo}`,
      };

      // Consome 1 unidade de cada peça original — ela continua disponível
      // pra novas junções até a quantidade usada se igualar à inicial.
      currentItens = currentItens.map(i => {
        if (i.item === item1.item) return { ...i, quantidadeUsada: (i.quantidadeUsada ?? 0) + 1 };
        if (i.item === item2.item) return { ...i, quantidadeUsada: (i.quantidadeUsada ?? 0) + 1 };
        return i;
      });

      currentItens.push(newItem);
    });

    return currentItens;
  };

  const confirmBulkMerge = () => {
    if (!nfeData || selectedSuggestedMerges.length === 0) return;
    const pairs = selectedSuggestedMerges.map(idx => suggestedMerges[idx]);
    setNfeData({ ...nfeData, itens: applyMergePairs(pairs, nfeData.itens) });
    setSuggestedMerges([]);
    setConfirmed(false);
  };

  // Tamanhos reconhecidos para a extensão automática de junção manual.
  const SIZE_TOKENS = ['P', 'M', 'G', 'GG', 'XG'];

  // Depois de uma junção manual, verifica se as mesmas 2 peças existem em
  // outras variações de tamanho (P/M/G/GG/XG) ainda não unidas, para
  // sugerir estender a junção a elas também.
  const findSizeVariations = (first: NFeItem, second: NFeItem, allItems: NFeItem[]) => {
    const lastWord = (s: string) => s.trim().split(' ').pop() || '';
    const stripLastWord = (s: string) => s.trim().split(' ').slice(0, -1).join(' ');

    const sizeFirst = lastWord(first.descricao).toUpperCase();
    const sizeSecond = lastWord(second.descricao).toUpperCase();
    if (sizeFirst !== sizeSecond || !SIZE_TOKENS.includes(sizeFirst)) return [];

    const baseFirst = stripLastWord(first.descricao);
    const baseSecond = stripLastWord(second.descricao);

    const available = allItems.filter(i =>
      i.item !== first.item && i.item !== second.item &&
      isDisponivel(i) && !i.conjunto?.includes('Composto')
    );

    const pairs: { item1: NFeItem; item2: NFeItem; suggestedName: string }[] = [];
    for (const size of SIZE_TOKENS) {
      if (size === sizeFirst) continue;
      const candA = available.find(i => i.descricao.trim().toUpperCase() === `${baseFirst} ${size}`.toUpperCase());
      const candB = available.find(i => i.descricao.trim().toUpperCase() === `${baseSecond} ${size}`.toUpperCase());
      if (candA && candB) {
        // Correspondência já validada pela base + tamanho — não precisa do
        // gate de sufixo comum do suggestMergeName.
        pairs.push({ item1: candA, item2: candB, suggestedName: buildMergedName(candA.descricao, candB.descricao) });
      }
    }
    return pairs;
  };

  const confirmMerge = () => {
    if (!nfeData || !mergeState.firstItem || !mergeState.secondItem || !mergeState.newName) return;
    if (sameType(mergeState.firstItem.descricao, mergeState.secondItem.descricao)) return;

    const first = mergeState.firstItem;
    const second = mergeState.secondItem;
    const totalCost = first.valorUnitario + second.valorUnitario;
    const conjuntoCodigo = `CJ-${first.codigo}-${second.codigo}`;

    const newItem: NFeItem = {
      item: Math.max(...nfeData.itens.map(i => i.item)) + 1,
      codigo: conjuntoCodigo,
      descricao: removerAcentos(mergeState.newName).toUpperCase(),
      ncm: first.ncm,
      cfop: first.cfop,
      unidade: "UN",
      quantidade: 1,
      valorUnitario: totalCost,
      valorTotal: totalCost,
      codigo_barras: `CJ${Date.now()}`,
      conjunto: `Composto por: ${first.codigo} e ${second.codigo}`,
    };

    // Consome 1 unidade de cada peça original — ela continua disponível pra
    // novas junções até a quantidade usada se igualar à inicial.
    const updatedItens = nfeData.itens.map(i => {
      if (i.item === first.item) return { ...i, quantidadeUsada: (i.quantidadeUsada ?? 0) + 1 };
      if (i.item === second.item) return { ...i, quantidadeUsada: (i.quantidadeUsada ?? 0) + 1 };
      return i;
    });

    // Antes de commitar, verifica se as mesmas 2 peças existem em outros
    // tamanhos ainda disponíveis, pra sugerir estender a junção.
    const extensions = findSizeVariations(first, second, nfeData.itens);

    setNfeData({ ...nfeData, itens: [...updatedItens, newItem] });
    setMergeState({ isOpen: false, firstItem: null, secondItem: null, newName: "" });
    setConfirmed(false);

    if (extensions.length > 0) {
      setSizeExtension(extensions);
      setSelectedSizeExtension(extensions.map((_, idx) => idx));
    } else {
      setSizeExtension(null);
      setSelectedSizeExtension([]);
    }
  };

  const confirmSizeExtension = () => {
    if (!nfeData || !sizeExtension || selectedSizeExtension.length === 0) return;
    const pairs = selectedSizeExtension.map(idx => sizeExtension[idx]);
    setNfeData({ ...nfeData, itens: applyMergePairs(pairs, nfeData.itens) });
    setSizeExtension(null);
    setSelectedSizeExtension([]);
    setConfirmed(false);
  };

  // Desfaz um conjunto já montado (automático ou manual): remove o item
  // CJ-composto e devolve os 2 itens originais para a lista, liberando-os
  // para uma nova junção.
  const undoMerge = (conjuntoItem: NFeItem) => {
    if (!nfeData) return;

    // Extrai os códigos dos 2 componentes a partir do próprio conjunto
    // ("Composto por: CODE1 e CODE2") — cada um pode ter sido usado em
    // outras junções também, então só devolve 1 unidade (decrementa), não
    // limpa tudo.
    const match = conjuntoItem.conjunto?.match(/^Composto por: (.+) e (.+)$/);
    if (!match) return;
    const [, code1, code2] = match;

    const updatedItens = nfeData.itens
      .filter(i => i.item !== conjuntoItem.item)
      .map(i => {
        if (i.codigo === code1 || i.codigo === code2) {
          return { ...i, quantidadeUsada: Math.max(0, (i.quantidadeUsada ?? 0) - 1) };
        }
        return i;
      });

    setNfeData({ ...nfeData, itens: updatedItens });
    setConfirmed(false);
  };

  const parseXML = (xmlText: string) => {
    try {
      const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "@_",
        // Mantém valores como string (não converte "02552710000150" em
        // número): senão zeros à esquerda de CNPJ/IE/códigos são perdidos
        // quando o XML é reexportado.
        parseTagValue: false,
      });
      const result = parser.parse(xmlText);

      const nfe = result.nfeProc?.NFe || result.NFe;
      if (!nfe) throw new Error("Estrutura de NF-e não encontrada no XML.");

      const infNFe = nfe.infNFe;
      const ide = infNFe.ide;
      const emit = infNFe.emit;
      const dest = infNFe.dest;
      const det = Array.isArray(infNFe.det) ? infNFe.det : [infNFe.det];
      const total = infNFe.total.ICMSTot;

      const mappedData: NFeData = {
        id: infNFe["@_Id"] || "",
        numero: ide.nNF,
        serie: ide.serie,
        dataEmissao: ide.dhEmi,
        naturezaOperacao: ide.natOp,
        emitente: {
          cnpj: String(emit.CNPJ).replace(/\D/g, ''),
          nome: emit.xNome,
          fantasia: emit.xFant,
        },
        destinatario: {
          cnpj: String(dest.CNPJ || dest.CPF).replace(/\D/g, ''),
          nome: dest.xNome,
          email: dest.email,
        },
        itens: det.map((d: any) => {
          const cEAN = d.prod.cEAN;
          const hasValidEAN = cEAN && cEAN !== "SEM GTIN" && cEAN.length >= 8;
          // Se não tiver EAN válido, gera um código interno: 789 (Brasil) + Código Produto + Nº da nota
          const generatedBarcode = hasValidEAN ? cEAN : `INT${d.prod.cProd}${ide.nNF}`;

          return {
            item: parseInt(d["@_nItem"]),
            codigo: d.prod.cProd,
            descricao: d.prod.xProd,
            ncm: d.prod.NCM,
            cfop: d.prod.CFOP,
            unidade: d.prod.uCom,
            quantidade: parseFloat(d.prod.qCom),
            valorUnitario: parseFloat(d.prod.vUnCom),
            valorTotal: parseFloat(d.prod.vProd),
            codigo_barras: generatedBarcode,
          };
        }),
        total: {
          valorProdutos: parseFloat(total.vProd),
          valorNota: parseFloat(total.vNF),
        },
      };

      const rawDetMap: Record<number, any> = {};
      det.forEach((d: any) => { rawDetMap[parseInt(d["@_nItem"])] = d; });

      setNfeData(mappedData);
      setRawNFe({
        "@_versao": infNFe["@_versao"],
        "@_Id": infNFe["@_Id"],
        ide,
        emit,
        dest,
        total: infNFe.total,
        transp: infNFe.transp,
        cobr: infNFe.cobr,
        pag: infNFe.pag,
        infAdic: infNFe.infAdic,
        infRespTec: infNFe.infRespTec,
      });
      setRawDetByItem(rawDetMap);
      setError(null);
      setConfirmed(false);
    } catch (err) {
      console.error(err);
      setError("Erro ao processar o arquivo XML. Verifique se é um arquivo de NF-e válido.");
      setNfeData(null);
      setRawNFe(null);
      setRawDetByItem({});
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        parseXML(text);
      };
      reader.readAsText(file);
    }
  };

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && (file.type === "text/xml" || file.name.endsWith(".xml"))) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        parseXML(text);
      };
      reader.readAsText(file);
    } else {
      setError("Por favor, envie um arquivo XML válido.");
    }
  }, []);

  const reset = () => {
    setNfeData(null);
    setRawNFe(null);
    setRawDetByItem({});
    setError(null);
    setConfirmed(false);
    setMarkupInput("0");
    setSizeExtension(null);
    setSelectedSizeExtension([]);
  };

  const exportXML = () => {
    if (!nfeData || !rawNFe) return;

    // Peças totalmente absorvidas por conjuntos (quantidadeUsada === quantidade)
    // não entram no XML final — só o que ainda sobra sem uso, e os conjuntos
    // compostos.
    const itensFinais = nfeData.itens.filter(isDisponivel);

    const detFinal = itensFinais.map(item => {
      const original = rawDetByItem[item.item];
      const usada = item.quantidadeUsada ?? 0;
      if (original && usada === 0) {
        // Item nunca envolvido em junção: repassa o <det> original, sem perdas.
        return { ...original };
      }
      if (original && usada > 0) {
        // Item parcialmente usado em conjunto(s): repassa o <det> original,
        // mas com a quantidade/valor ajustados pro que ainda sobra.
        const restante = item.quantidade - usada;
        const valorUnit = item.valorUnitario;
        return {
          ...original,
          prod: {
            ...original.prod,
            qCom: restante.toFixed(4),
            vProd: (valorUnit * restante).toFixed(2),
            qTrib: restante.toFixed(4),
          },
        };
      }

      // Conjunto composto: monta um <det> a partir dos dados calculados.
      // O conjunto não existia no NF-e original, então não tem uma
      // classificação fiscal própria — reaproveita o bloco <imposto> do
      // primeiro componente como aproximação, só para manter o XML válido.
      const match = item.conjunto?.match(/^Composto por: (.+) e (.+)$/);
      const firstCode = match?.[1];
      const firstComponentItem = nfeData.itens.find(i => i.codigo === firstCode);
      const firstComponentDet = firstComponentItem ? rawDetByItem[firstComponentItem.item] : undefined;

      return {
        prod: {
          cProd: item.codigo,
          cEAN: "SEM GTIN",
          xProd: item.descricao,
          NCM: item.ncm,
          CFOP: item.cfop,
          uCom: item.unidade,
          qCom: item.quantidade.toFixed(4),
          vUnCom: item.valorUnitario.toFixed(10),
          vProd: item.valorTotal.toFixed(2),
          cEANTrib: "SEM GTIN",
          uTrib: item.unidade,
          qTrib: item.quantidade.toFixed(4),
          vUnTrib: item.valorUnitario.toFixed(10),
          indTot: "1",
        },
        ...(firstComponentDet?.imposto ? { imposto: firstComponentDet.imposto } : {}),
      };
    });

    // Renumera os <det> sequencialmente (1..N) — a numeração original fica
    // com buracos depois que as peças absorvidas são removidas.
    detFinal.forEach((d, idx) => { d["@_nItem"] = String(idx + 1); });

    const infNFe: Record<string, any> = {
      "@_versao": rawNFe["@_versao"],
      "@_Id": rawNFe["@_Id"],
      ide: rawNFe.ide,
      emit: rawNFe.emit,
      dest: rawNFe.dest,
      det: detFinal,
      total: rawNFe.total,
    };
    if (rawNFe.transp) infNFe.transp = rawNFe.transp;
    if (rawNFe.cobr) infNFe.cobr = rawNFe.cobr;
    if (rawNFe.pag) infNFe.pag = rawNFe.pag;
    if (rawNFe.infAdic) infNFe.infAdic = rawNFe.infAdic;
    if (rawNFe.infRespTec) infNFe.infRespTec = rawNFe.infRespTec;

    // Sem <Signature>/<protNFe>: são amarrados criptograficamente ao
    // conteúdo original e ficariam inválidos com os itens recombinados —
    // incluí-los aqui passaria a impressão falsa de autorização da SEFAZ.
    const builder = new XMLBuilder({ format: true, ignoreAttributes: false, attributeNamePrefix: "@_" });
    const xmlObj = {
      NFe: {
        "@_xmlns": "http://www.portalfiscal.inf.br/nfe",
        infNFe,
      },
    };

    // UTF-8 sem BOM — igual aos XMLs de NF-e reais autorizados pela SEFAZ
    // (nenhum dos exemplos reais que testamos tem BOM). O teste com
    // ISO-8859-1 deu "?" no lugar de acento no HW Sistemas, sinal de que o
    // importador decodifica como UTF-8 e rejeita bytes Latin-1 inválidos
    // para essa codificação — então UTF-8 puro é o formato certo; a BOM
    // adicionada antes é a suspeita principal por ainda dar erro.
    const xmlContent = '<?xml version="1.0" encoding="UTF-8"?>\n' + builder.build(xmlObj);
    const blob = new Blob([xmlContent], { type: 'application/xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nfe-${nfeData.numero}-conjuntos.xml`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-[#1A1A1A] font-sans selection:bg-emerald-100 flex flex-col">
      <header className="bg-white border-b border-zinc-200 px-6 py-4 sticky top-0 z-20">
        <div className="max-w-[1600px] mx-auto flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="bg-emerald-600 p-2 rounded-lg shadow-sm">
              <ReceiptText className="text-white w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Editor XML</h1>
              <p className="text-xs text-zinc-400">Importação de NF-e e montagem de conjuntos</p>
            </div>
          </div>
          {nfeData && (
            <button
              onClick={reset}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition-all"
            >
              <RotateCcw className="w-4 h-4" />
              Nova Importação
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 max-w-[1600px] w-full mx-auto px-6 py-8">
        <AnimatePresence mode="wait">
          {!nfeData ? (
            <motion.div
              key="uploader"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="mt-12"
            >
              <div
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
                className={cn(
                  "relative group cursor-pointer border-2 border-dashed rounded-3xl p-12 transition-all duration-300 flex flex-col items-center justify-center text-center",
                  isDragging
                    ? "border-emerald-500 bg-emerald-50/50"
                    : "border-zinc-300 hover:border-emerald-400 hover:bg-white"
                )}
              >
                <input
                  type="file"
                  accept=".xml"
                  onChange={handleFileUpload}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />

                <div className={cn(
                  "w-20 h-20 rounded-2xl flex items-center justify-center mb-6 transition-transform duration-300 group-hover:scale-110",
                  isDragging ? "bg-emerald-500 text-white" : "bg-emerald-100 text-emerald-600"
                )}>
                  <Upload className="w-10 h-10" />
                </div>

                <h2 className="text-2xl font-semibold mb-2">Importar XML de NF-e</h2>
                <p className="text-zinc-500 max-w-sm mb-8">
                  Arraste seu arquivo XML aqui ou clique para selecionar do seu computador.
                </p>

                <div className="flex gap-4">
                  <div className="flex items-center gap-2 text-xs font-medium text-zinc-400 uppercase tracking-widest">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    Processado no navegador
                  </div>
                </div>
              </div>

              {error && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-6 p-4 bg-red-50 border border-red-100 rounded-xl flex items-center gap-3 text-red-600"
                >
                  <AlertCircle className="w-5 h-5 flex-shrink-0" />
                  <p className="text-sm font-medium">{error}</p>
                </motion.div>
              )}
            </motion.div>
          ) : (
            <motion.div key="data" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
              {/* Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card
                  icon={<ReceiptText className="w-5 h-5" />}
                  label="Número da Nota"
                  value={nfeData.numero}
                  subValue={`Série ${nfeData.serie}`}
                />
                <Card
                  icon={<Building2 className="w-5 h-5" />}
                  label="Emitente"
                  value={nfeData.emitente.fantasia || nfeData.emitente.nome}
                  subValue={nfeData.emitente.cnpj}
                />
                <Card
                  icon={<Package className="w-5 h-5" />}
                  label="Itens"
                  value={String(nfeData.itens.length)}
                  subValue={formatCurrency(nfeData.total.valorNota)}
                />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
                <div className="space-y-6">
                  <section className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
                    <div className="px-6 py-4 border-b border-zinc-100 flex items-center justify-between">
                      <h3 className="font-semibold text-zinc-900">Itens da Nota</h3>
                      <p className="text-xs text-zinc-400">
                        Clique em <GitMerge className="w-3 h-3 inline mx-0.5" /> para unir dois itens em um conjunto,
                        ou em <Undo2 className="w-3 h-3 inline mx-0.5" /> para desfazer um conjunto já montado
                      </p>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-zinc-50 text-left text-[11px] font-bold text-zinc-400 uppercase tracking-wider">
                          <tr>
                            <th className="px-6 py-3">Cód / Descrição</th>
                            <th className="px-6 py-3 text-right">Qtd</th>
                            <th className="px-6 py-3 text-right">Custo Unit.</th>
                            <th className="px-6 py-3 text-right bg-emerald-50/30">Venda Sugerida</th>
                            <th className="px-6 py-3 text-center">Ações</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-50">
                          {nfeData.itens.map((item) => (
                            <tr key={item.item} className="hover:bg-zinc-50/50 transition-colors group">
                              <td className="px-6 py-4">
                                <div className="text-sm font-medium text-zinc-900">{item.descricao}</div>
                                <div className="text-xs text-zinc-400 font-mono mt-0.5">{item.codigo}</div>
                                {item.conjunto && (
                                  <div className="text-[10px] font-semibold uppercase tracking-wide mt-1 text-indigo-600">
                                    {item.conjunto}
                                  </div>
                                )}
                                {!!item.quantidadeUsada && (
                                  <div className={cn(
                                    "text-[10px] font-semibold uppercase tracking-wide mt-1",
                                    isDisponivel(item) ? "text-amber-600" : "text-zinc-400"
                                  )}>
                                    {item.quantidadeUsada} de {item.quantidade}{' '}
                                    {item.quantidadeUsada === 1 ? 'unidade usada' : 'unidades usadas'} em conjunto
                                  </div>
                                )}
                              </td>
                              <td className="px-6 py-4 text-right text-sm text-zinc-600">
                                {item.quantidade} <span className="text-[10px] text-zinc-400">{item.unidade}</span>
                              </td>
                              <td className="px-6 py-4 text-right text-sm text-zinc-600">
                                {formatCurrency(item.valorUnitario)}
                              </td>
                              <td className="px-6 py-4 text-right text-sm font-bold text-emerald-600 bg-emerald-50/30">
                                {formatCurrency(calculateMarkupPrice(item.valorUnitario))}
                              </td>
                              <td className="px-6 py-4">
                                <div className="flex items-center justify-center gap-3">
                                  {isDisponivel(item) && (
                                    <button
                                      onClick={() => openMerge(item)}
                                      title="Unir em um conjunto"
                                      className="p-1.5 rounded-lg text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 transition-all"
                                    >
                                      <GitMerge className="w-4 h-4" />
                                    </button>
                                  )}
                                  {item.conjunto?.includes('Composto') && (
                                    <button
                                      onClick={() => undoMerge(item)}
                                      title="Desfazer conjunto"
                                      className="p-1.5 rounded-lg text-zinc-400 hover:bg-red-50 hover:text-red-600 transition-all"
                                    >
                                      <Undo2 className="w-4 h-4" />
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>

                  {/* Bulk Merge Suggestions */}
                  {suggestedMerges.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-indigo-600 rounded-2xl p-6 text-white shadow-xl shadow-indigo-100 space-y-4"
                    >
                      <div className="flex flex-col md:flex-row items-center justify-between gap-6">
                        <div className="flex items-center gap-4">
                          <div className="p-3 bg-white/20 rounded-xl">
                            <GitMerge className="w-6 h-6" />
                          </div>
                          <div>
                            <h3 className="font-bold text-lg">Sugestões de Junção Encontradas</h3>
                            <p className="text-indigo-100 text-sm">
                              Identificamos {suggestedMerges.length} possíveis conjuntos baseados na semelhança dos nomes.
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 w-full md:w-auto">
                          <button
                            onClick={() => setSuggestedMerges([])}
                            className="flex-1 md:flex-none px-6 py-2.5 rounded-xl text-sm font-semibold text-white/80 hover:text-white hover:bg-white/10 transition-all"
                          >
                            Ignorar
                          </button>
                          <button
                            onClick={confirmBulkMerge}
                            disabled={selectedSuggestedMerges.length === 0}
                            className="flex-1 md:flex-none px-8 py-2.5 bg-white text-indigo-600 rounded-xl text-sm font-bold hover:bg-indigo-50 transition-all shadow-lg disabled:opacity-50"
                          >
                            Confirmar Selecionadas ({selectedSuggestedMerges.length})
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-white/10">
                        {suggestedMerges.map((merge, idx) => (
                          <button
                            key={idx}
                            onClick={() => {
                              setSelectedSuggestedMerges(prev =>
                                prev.includes(idx) ? prev.filter(i => i !== idx) : [...prev, idx]
                              );
                            }}
                            className={cn(
                              "relative text-left rounded-2xl p-5 transition-all border",
                              selectedSuggestedMerges.includes(idx)
                                ? "bg-white/20 border-white/30 shadow-inner"
                                : "bg-white/5 border-transparent hover:bg-white/10"
                            )}
                          >
                            <div className="absolute top-4 right-4">
                              {selectedSuggestedMerges.includes(idx) ? (
                                <CheckSquare className="w-5 h-5 text-white" />
                              ) : (
                                <Square className="w-5 h-5 text-white/30" />
                              )}
                            </div>
                            <div className="text-xs font-bold text-indigo-200 uppercase tracking-widest mb-4 pr-8">
                              Sugestão: {merge.suggestedName}
                            </div>
                            <div className="space-y-3">
                              <div className="flex items-start gap-3">
                                <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 mt-1.5 flex-shrink-0" />
                                <div className="text-xs text-white/90 leading-relaxed">{merge.item1.descricao}</div>
                              </div>
                              <div className="flex items-start gap-3">
                                <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 mt-1.5 flex-shrink-0" />
                                <div className="text-xs text-white/90 leading-relaxed">{merge.item2.descricao}</div>
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </motion.div>
                  )}

                  {/* Size Extension Suggestions (after a manual merge) */}
                  {sizeExtension && sizeExtension.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-violet-600 rounded-2xl p-6 text-white shadow-xl shadow-violet-100 space-y-4"
                    >
                      <div className="flex flex-col md:flex-row items-center justify-between gap-6">
                        <div className="flex items-center gap-4">
                          <div className="p-3 bg-white/20 rounded-xl">
                            <GitMerge className="w-6 h-6" />
                          </div>
                          <div>
                            <h3 className="font-bold text-lg">Estender Junção Manual a Outros Tamanhos</h3>
                            <p className="text-violet-100 text-sm">
                              As mesmas peças que você acabou de unir também existem em {sizeExtension.length}{' '}
                              {sizeExtension.length === 1 ? 'outro tamanho' : 'outros tamanhos'}.
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 w-full md:w-auto">
                          <button
                            onClick={() => { setSizeExtension(null); setSelectedSizeExtension([]); }}
                            className="flex-1 md:flex-none px-6 py-2.5 rounded-xl text-sm font-semibold text-white/80 hover:text-white hover:bg-white/10 transition-all"
                          >
                            Ignorar
                          </button>
                          <button
                            onClick={confirmSizeExtension}
                            disabled={selectedSizeExtension.length === 0}
                            className="flex-1 md:flex-none px-8 py-2.5 bg-white text-violet-600 rounded-xl text-sm font-bold hover:bg-violet-50 transition-all shadow-lg disabled:opacity-50"
                          >
                            Confirmar Selecionadas ({selectedSizeExtension.length})
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-white/10">
                        {sizeExtension.map((pair, idx) => (
                          <button
                            key={idx}
                            onClick={() => {
                              setSelectedSizeExtension(prev =>
                                prev.includes(idx) ? prev.filter(i => i !== idx) : [...prev, idx]
                              );
                            }}
                            className={cn(
                              "relative text-left rounded-2xl p-5 transition-all border",
                              selectedSizeExtension.includes(idx)
                                ? "bg-white/20 border-white/30 shadow-inner"
                                : "bg-white/5 border-transparent hover:bg-white/10"
                            )}
                          >
                            <div className="absolute top-4 right-4">
                              {selectedSizeExtension.includes(idx) ? (
                                <CheckSquare className="w-5 h-5 text-white" />
                              ) : (
                                <Square className="w-5 h-5 text-white/30" />
                              )}
                            </div>
                            <div className="text-xs font-bold text-violet-200 uppercase tracking-widest mb-4 pr-8">
                              Sugestão: {pair.suggestedName}
                            </div>
                            <div className="space-y-3">
                              <div className="flex items-start gap-3">
                                <div className="w-1.5 h-1.5 rounded-full bg-violet-400 mt-1.5 flex-shrink-0" />
                                <div className="text-xs text-white/90 leading-relaxed">{pair.item1.descricao}</div>
                              </div>
                              <div className="flex items-start gap-3">
                                <div className="w-1.5 h-1.5 rounded-full bg-violet-400 mt-1.5 flex-shrink-0" />
                                <div className="text-xs text-white/90 leading-relaxed">{pair.item2.descricao}</div>
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </div>

                <div className="space-y-6">
                  <section className="bg-white rounded-2xl border border-zinc-200 p-6 shadow-sm">
                    <h3 className="font-semibold mb-4 text-zinc-900">Resumo Financeiro</h3>
                    <div className="space-y-3">
                      <div className="flex justify-between text-sm">
                        <span className="text-zinc-500">Total de Produtos</span>
                        <span className="font-medium">{formatCurrency(nfeData.total.valorProdutos)}</span>
                      </div>
                      <div className="pt-3 border-t border-zinc-100 flex justify-between items-end">
                        <span className="text-sm font-semibold text-zinc-900 uppercase tracking-wider">Valor Total</span>
                        <span className="text-2xl font-bold text-emerald-600">{formatCurrency(nfeData.total.valorNota)}</span>
                      </div>
                    </div>

                    <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mt-6 mb-2">
                      Markup padrão (%)
                    </label>
                    <input
                      type="number"
                      value={markupInput}
                      onChange={(e) => setMarkupInput(e.target.value)}
                      className="w-full px-3 py-2 border border-zinc-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />

                    {error && (
                      <div className="mt-4 p-3 bg-red-50 border border-red-100 rounded-xl flex items-center gap-2 text-red-600">
                        <AlertCircle className="w-4 h-4 flex-shrink-0" />
                        <p className="text-xs font-medium">{error}</p>
                      </div>
                    )}

                    <button
                      onClick={() => setConfirmed(true)}
                      disabled={confirmed}
                      className={cn(
                        "w-full mt-6 font-semibold py-3 rounded-xl transition-all flex items-center justify-center gap-2 group shadow-lg",
                        confirmed
                          ? "bg-emerald-100 text-emerald-700 shadow-emerald-50"
                          : "bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-200"
                      )}
                    >
                      {confirmed ? (
                        <>
                          <CheckCircle2 className="w-5 h-5" />
                          Conjuntos Confirmados
                        </>
                      ) : (
                        <>
                          Confirmar Conjuntos
                          <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                        </>
                      )}
                    </button>

                    {confirmed && (
                      <button
                        onClick={exportXML}
                        className="w-full mt-3 font-semibold py-3 rounded-xl transition-all flex items-center justify-center gap-2 bg-zinc-900 hover:bg-zinc-800 text-white"
                      >
                        <Download className="w-4 h-4" />
                        Baixar XML
                      </button>
                    )}
                  </section>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Modal de junção manual */}
      <AnimatePresence>
        {mergeState.isOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMergeState({ ...mergeState, isOpen: false })}
              className="absolute inset-0 bg-zinc-900/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
                <div>
                  <h2 className="font-bold text-zinc-900">Montar Novo Conjunto</h2>
                  <p className="text-xs text-zinc-500 mt-1">Combine dois itens para formar um novo conjunto</p>
                </div>
                <button
                  onClick={() => setMergeState({ ...mergeState, isOpen: false })}
                  className="p-1.5 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded-lg transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="overflow-y-auto p-6 space-y-4">
                {/* Primeiro produto */}
                <div className="p-4 border border-emerald-200 bg-emerald-50/50 rounded-xl">
                  <div className="text-[9px] font-mono font-bold text-emerald-600 uppercase tracking-wider mb-1">Item 1</div>
                  <div className="font-semibold text-zinc-900 text-sm">{mergeState.firstItem?.descricao}</div>
                  <div className="text-xs text-zinc-500 mt-1">Custo: {formatCurrency(mergeState.firstItem?.valorUnitario || 0)}</div>
                </div>

                {/* Segundo produto */}
                <div className={cn(
                  "p-4 border rounded-xl",
                  mergeState.secondItem ? "border-emerald-200 bg-emerald-50/50" : "border-dashed border-zinc-200"
                )}>
                  {mergeState.secondItem ? (
                    <>
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="text-[9px] font-mono font-bold text-emerald-600 uppercase tracking-wider mb-1">Item 2</div>
                          <div className="font-semibold text-zinc-900 text-sm">{mergeState.secondItem.descricao}</div>
                          <div className="text-xs text-zinc-500 mt-1">Custo: {formatCurrency(mergeState.secondItem.valorUnitario)}</div>
                        </div>
                        <button
                          onClick={() => setMergeState({ ...mergeState, secondItem: null })}
                          className="p-1 text-zinc-400 hover:text-red-500 transition-colors"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="text-xs text-zinc-400 mb-4">Selecione o segundo item abaixo</p>
                      <div className="space-y-1.5 max-h-48 overflow-y-auto">
                        {nfeData?.itens
                          .filter(i =>
                            i.item !== mergeState.firstItem?.item &&
                            isDisponivel(i) &&
                            !sameType(mergeState.firstItem!.descricao, i.descricao)
                          )
                          .map(item => (
                            <button
                              key={item.item}
                              onClick={() => {
                                const suggested = suggestMergeName(mergeState.firstItem!.descricao, item.descricao);
                                setMergeState({ ...mergeState, secondItem: item, newName: suggested });
                              }}
                              className="w-full text-left px-3 py-2 rounded-lg hover:bg-white text-xs text-zinc-700 transition-colors"
                            >
                              {item.descricao}
                            </button>
                          ))}
                      </div>
                    </>
                  )}
                </div>

                {mergeState.secondItem && (
                  <div>
                    <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">Nome do Novo Conjunto</label>
                    <input
                      type="text"
                      value={mergeState.newName}
                      onChange={(e) => setMergeState({ ...mergeState, newName: e.target.value })}
                      placeholder="Digite o nome para este conjunto..."
                      className="w-full px-3 py-2 border border-zinc-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                    <div className="flex justify-between items-center mt-3 px-1">
                      <span className="text-xs text-zinc-500">Custo total do conjunto</span>
                      <span className="text-sm font-bold text-zinc-900">
                        {formatCurrency((mergeState.firstItem?.valorUnitario || 0) + (mergeState.secondItem?.valorUnitario || 0))}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <div className="px-6 py-4 border-t border-zinc-100 flex gap-3">
                <button
                  onClick={() => setMergeState({ ...mergeState, isOpen: false })}
                  className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold text-zinc-500 hover:bg-zinc-100 transition-all"
                >
                  Cancelar
                </button>
                <button
                  onClick={confirmMerge}
                  disabled={!mergeState.newName || !mergeState.secondItem}
                  className="flex-1 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-bold transition-all disabled:opacity-50"
                >
                  Criar Conjunto
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
