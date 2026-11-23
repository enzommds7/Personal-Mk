# Recuperação segura de dados — PersonalMk

## Antes de atualizar ou limpar o navegador

1. No dispositivo que contém as anotações importantes, exporte o backup JSON pelo próprio aplicativo.
2. Guarde uma cópia fora do navegador (em armazenamento privado). **Não envie o JSON para o GitHub:** ele pode conter links privados, credenciais e imagens.
3. Verifique que o arquivo abre como JSON e contém o objeto `days`. Faça uma segunda cópia.
4. Não limpe dados do site, não desinstale o PWA e não importe um backup sobre dados existentes sem antes exportá-los.
5. Não trate o indicador “Sincronizado” de versões antigas como garantia de que o Firestore recebeu todas as alterações.

## Critério para migração

O backup do PC de trabalho é a fonte de recuperação escolhida pelo proprietário. Dados de outros dispositivos não precisam ser mesclados, **mas não devem ser apagados automaticamente**. A migração deve ter importação explícita, verificação de contagem de registros e confirmação antes de qualquer substituição.

## Status técnico

- [x] Backup exportado e mantido fora do repositório
- [x] Service Worker: cache limitado aos recursos do aplicativo
- [x] Sincronização: falhas de upload deixam de ser tratadas como sucesso
- [ ] Importação com pré-visualização, validação e rollback
- [ ] Estratégia de conflitos e fila offline
- [ ] Testes em múltiplos navegadores/dispositivos
- [ ] Revisão de regras de segurança do Firebase

**Não fazer merge desta branch enquanto as etapas críticas não estiverem verificadas.**
