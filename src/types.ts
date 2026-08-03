export interface NFeItem {
  item: number;
  codigo: string;
  descricao: string;
  ncm: string;
  cfop: string;
  unidade: string;
  quantidade: number;
  valorUnitario: number;
  valorTotal: number;
  codigo_barras?: string;
  // Presente quando o item é o resultado de uma junção manual ou automática,
  // ou quando foi absorvido por um conjunto ("Integrado no conjunto: CJ-...").
  conjunto?: string;
}

export interface NFeData {
  id: string;
  numero: string;
  serie: string;
  dataEmissao: string;
  naturezaOperacao: string;
  emitente: {
    cnpj: string;
    nome: string;
    fantasia?: string;
  };
  destinatario: {
    cnpj: string;
    nome: string;
    email?: string;
  };
  itens: NFeItem[];
  total: {
    valorProdutos: number;
    valorNota: number;
  };
}
