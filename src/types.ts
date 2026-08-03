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
  // Presente quando o item é o resultado de uma junção manual ou automática:
  // "Composto por: CODE1 e CODE2".
  conjunto?: string;
  // Quantas unidades deste item já foram usadas em conjuntos até agora.
  // O item continua disponível para novas junções enquanto
  // quantidadeUsada < quantidade — só fica indisponível quando as duas se
  // igualam (todas as unidades já viraram conjunto).
  quantidadeUsada?: number;
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
